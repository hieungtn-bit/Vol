import { join } from 'node:path';
import { buildFundingHistory } from './derivatives';
import { archiveGet, toMs } from './minute';
import type { Derivatives, FundingInfo, OIInfo, OIRead } from './types';

// ============================================================
// PHÁI SINH LỊCH SỬ TỪ KHO LƯU TRỮ BINANCE.
//
// Backtest cho tới nay chạy MÙ PHÁI SINH: OI, funding và taker perp đều N/A, nên
// ba vế đó — chiếm 40 trên 103 trọng số chấm điểm — chưa bao giờ được kiểm chứng.
// Trọng số của chúng là niềm tin, không phải bằng chứng. Đây là chỗ sửa việc đó.
//
// Blocker cũ "phải vào được fapi.binance.com" là SAI: fapi chặn IP, nhưng kho lưu
// trữ là file tĩnh trên data.binance.vision và không chặn.
//
//   futures/um/monthly/fundingRate/<SYM>/   calc_time, funding_interval_hours, last_funding_rate
//   futures/um/daily/metrics/<SYM>/         create_time, sum_open_interest, ... (ảnh chụp mỗi 5 phút)
//   futures/um/monthly/klines/<SYM>/<TF>/   ... taker_buy_volume  → taker delta PERP
//
// BA BẪY ĐÃ VẤP, mỗi cái đều làm hỏng lặng lẽ:
//
// 1. `create_time` trong metrics là CHUỖI "2026-07-15 00:00:00" theo UTC, không
//    phải epoch. Parse bằng `new Date(chuỗi)` sẽ ra giờ địa phương ở một số môi
//    trường — lệch cả múi giờ mà không báo lỗi.
// 2. Klines FUTURES dùng mili giây, klines SPOT dùng micro giây. Cùng một hàm
//    đọc, hai đơn vị.
// 3. Funding không phải lúc nào cũng 8 giờ một kỳ. ENA settle mỗi 4h. Cộng thẳng
//    rate của hai kỳ 4h vào cùng thang với một kỳ 8h là nhân đôi con số.
// ============================================================

/** Kho chỉ có metrics theo NGÀY, không có theo tháng. */
const METRIC_SNAP_MS = 5 * 60_000;

function futuresPath(kind: 'monthly' | 'daily', rest: string) {
  return `data/futures/um/${kind}/${rest}`;
}

/** "2026-07-15 00:00:00" (UTC) → epoch ms. Tự ghép chữ Z, không nhờ máy đoán. */
export function utcStampToMs(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export interface FundingRow {
  /** Thời điểm CHỐT kỳ funding. */
  t: number;
  /** Rate của kỳ, đã quy về thang 8 giờ. */
  rate8h: number;
  /** Rate nguyên bản của kỳ, chưa quy đổi. */
  raw: number;
  intervalHours: number;
}

export interface MetricRow {
  t: number;
  openInterest: number;
  openInterestUsd: number;
  topLongShortRatio: number | null;
  retailLongShortRatio: number | null;
  takerLongShortVolRatio: number | null;
}

export interface PerpBar {
  t: number;
  c: number;
  v: number;
  takerBuyBase: number;
}

function monthsBetween(from: number, to: number): string[] {
  const out: string[] = [];
  const d = new Date(from);
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= to) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

function daysBetween(from: number, to: number): string[] {
  const out: string[] = [];
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= to) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const rows = (csv: string) => csv.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);

/** Funding đã chốt, cũ → mới, rate quy về thang 8 giờ. */
export async function loadFunding(symbol: string, from: number, to: number): Promise<FundingRow[]> {
  const out: FundingRow[] = [];
  for (const m of monthsBetween(from, to)) {
    const name = `${symbol}-fundingRate-${m}.zip`;
    const csv = await archiveGet(
      futuresPath('monthly', `fundingRate/${symbol}/${name}`),
      join('deriv', symbol, name),
    );
    if (!csv) continue;
    for (const line of rows(csv)) {
      const f = line.split(',');
      const t = toMs(Number(f[0]));
      const hours = Number(f[1]) || 8;
      const raw = Number(f[2]);
      if (!Number.isFinite(t) || !Number.isFinite(raw) || t < from || t > to) continue;
      // Quy về thang 8h: một kỳ 4h thu 0.01% tương đương 0.02% trên 8h.
      out.push({ t, raw, intervalHours: hours, rate8h: raw * (8 / hours) });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Ảnh chụp OI và thế đứng mỗi 5 phút, cũ → mới. */
export async function loadMetrics(symbol: string, from: number, to: number): Promise<MetricRow[]> {
  const out: MetricRow[] = [];
  for (const day of daysBetween(from, to)) {
    const name = `${symbol}-metrics-${day}.zip`;
    const csv = await archiveGet(
      futuresPath('daily', `metrics/${symbol}/${name}`),
      join('deriv', symbol, name),
    );
    if (!csv) continue;
    for (const line of rows(csv)) {
      const f = line.split(',');
      const t = utcStampToMs(f[0]);
      if (!Number.isFinite(t) || t < from || t > to) continue;
      const num = (x: string) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
      out.push({
        t,
        openInterest: Number(f[2]),
        openInterestUsd: Number(f[3]),
        topLongShortRatio: num(f[5]),        // sum_toptrader_long_short_ratio
        retailLongShortRatio: num(f[6]),     // count_long_short_ratio
        takerLongShortVolRatio: num(f[7]),
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Nến perp — cần `taker_buy_volume` để có taker delta của chính chợ perp. */
export async function loadPerpBars(symbol: string, tf: string, from: number, to: number): Promise<PerpBar[]> {
  const out: PerpBar[] = [];
  for (const m of monthsBetween(from, to)) {
    const name = `${symbol}-${tf}-${m}.zip`;
    const csv = await archiveGet(
      futuresPath('monthly', `klines/${symbol}/${tf}/${name}`),
      join('deriv', symbol, tf, name),
    );
    if (!csv) continue;
    for (const line of rows(csv)) {
      const f = line.split(',');
      const t = toMs(Number(f[0]));
      if (!Number.isFinite(t) || t < from || t > to) continue;
      out.push({ t, c: +f[4], v: +f[5], takerBuyBase: +f[9] });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Bản ghi gần nhất KHÔNG MUỘN HƠN `t`.
 *
 * Đây là toàn bộ chỗ chống nhìn trộm tương lai của module này. Funding chốt lúc
 * 16:00 thì tại nến 15:45 ta CHƯA biết nó — dùng nhầm là backtest tự cho mình
 * biết trước, và mọi con số sau đó thành rác.
 */
export function asOf<T extends { t: number }>(sorted: T[], t: number): T | null {
  let lo = 0, hi = sorted.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? sorted[ans] : null;
}

// ------------------------------------------------------------
// Dựng Derivatives TẠI MỘT THỜI ĐIỂM.
// ------------------------------------------------------------

const FLAT_FR = 0.0002;      // 0.02% / 8h — giống hệt lib/derivatives.ts
const EXTREME_FR = 0.0005;
/** Bao nhiêu kỳ funding đưa vào lịch sử. Bằng đúng số kỳ đường live dùng. */
const FUNDING_HISTORY_N = 12;

export interface DerivArchive {
  funding: FundingRow[];
  metrics: MetricRow[];
  /** Nến perp ở ĐÚNG khung backtest — dùng cho taker delta. */
  perp: PerpBar[];
  /**
   * Nến perp 1 GIỜ, tải bất kể khung backtest là gì.
   *
   * Cách đọc OI so Δ OI với Δ GIÁ 1 GIỜ, và đường live lấy Δ giá đó từ chuỗi 1h
   * (`k1h` trong scan.ts). Nếu backtest khung 4h mà lấy Δ giá của một nến 4h rồi
   * gọi nó là "Δ 1h" thì đang so hai thứ khác nhau, và cách đọc OI sẽ khác hẳn
   * đường live — tức là kiểm chứng một hệ khác hệ đang chạy.
   */
  perp1h: PerpBar[];
}

/** Tải trọn bộ phái sinh cho một mã trong một khoảng. */
export async function loadDerivArchive(
  symbol: string, tf: string, from: number, to: number,
): Promise<DerivArchive> {
  // Funding cần lùi thêm để lịch sử tại nến đầu tiên cũng đủ kỳ.
  const back = from - FUNDING_HISTORY_N * 8 * 3_600_000;
  const [funding, metrics, perp, perp1h] = await Promise.all([
    loadFunding(symbol, back, to),
    loadMetrics(symbol, from - 25 * 3_600_000, to),   // lùi 25h cho phép tính Δ24h
    loadPerpBars(symbol, tf, from, to),
    tf === '1h' ? Promise.resolve(null) : loadPerpBars(symbol, '1h', from - 3 * 3_600_000, to),
  ]);
  return { funding, metrics, perp, perp1h: perp1h ?? perp };
}

/**
 * Δ giá 1 giờ tính tới thời điểm `t`, từ chuỗi nến perp 1h.
 *
 * Chỉ dùng nến đã ĐÓNG trước `t`: nến 1h chứa `t` vẫn đang chạy, giá đóng của nó
 * là thông tin của tương lai.
 */
export function priceChg1h(a: DerivArchive, t: number): number | null {
  const closed = a.perp1h.filter((b) => b.t + 3_600_000 <= t);
  if (closed.length < 2) return null;
  const now = closed[closed.length - 1].c;
  const prev = closed[closed.length - 2].c;
  return prev > 0 ? ((now - prev) / prev) * 100 : null;
}

/**
 * Ảnh chụp phái sinh đúng như hệ nhìn thấy TẠI thời điểm `t` (đóng nến).
 *
 *
 * Trường nào không có dữ liệu thì để UNAVAILABLE và KHÔNG chấm điểm. Điền số
 * giả cho một vế thiếu là cách chắc chắn nhất để backtest báo có edge ở một chỗ
 * không có gì.
 */
export function derivAt(
  a: DerivArchive,
  t: number,
): { deriv: Derivatives; perpRows: { buy: number; sell: number }[] | null;
     positioning: { retailLongPct: number | null; topLongPct: number | null } } {
  const priceChg1hPct = priceChg1h(a, t);
  // ---- Funding ----
  const fr = asOf(a.funding, t);
  let funding: FundingInfo;
  if (fr) {
    const past = a.funding.filter((r) => r.t <= t).slice(-FUNDING_HISTORY_N).map((r) => r.rate8h);
    funding = {
      quality: 'REAL', venue: 'binance-perp (kho lưu trữ)',
      rate: fr.rate8h, nextFundingTime: fr.t + fr.intervalHours * 3_600_000,
      markPrice: null,
      flat: Math.abs(fr.rate8h) < FLAT_FR,
      extreme: Math.abs(fr.rate8h) >= EXTREME_FR,
      history: buildFundingHistory(past),
      note: `kỳ ${fr.intervalHours}h, đã quy về thang 8h`,
    };
  } else {
    funding = {
      quality: 'UNAVAILABLE', venue: null, rate: null, nextFundingTime: null,
      markPrice: null, flat: false, extreme: false, history: null,
      note: 'N/A — kho không có kỳ funding nào trước thời điểm này.',
    };
  }

  // ---- OI ----
  const now = asOf(a.metrics, t);
  const h1 = asOf(a.metrics, t - 3_600_000);
  const h24 = asOf(a.metrics, t - 24 * 3_600_000);
  let oi: OIInfo;
  if (now) {
    const pctChg = (old: MetricRow | null) =>
      old && old.openInterest > 0 ? ((now.openInterest - old.openInterest) / old.openInterest) * 100 : null;
    const chg1h = pctChg(h1);
    const chg24h = pctChg(h24);

    // Cùng bảng đọc với lib/derivatives.ts — nếu ở đây đọc khác thì backtest
    // đang kiểm chứng một hệ khác hệ đang chạy.
    let read: OIRead = 'na';
    if (chg1h != null && priceChg1hPct != null) {
      const oiUp = chg1h > 0.5, oiDn = chg1h < -0.5;
      const pUp = priceChg1hPct > 0.15, pDn = priceChg1hPct < -0.15;
      if (oiDn && pDn) read = 'long-cover';
      else if (oiUp && pUp) read = 'new-longs';
      else if (oiDn && pUp) read = 'short-cover';
      else if (oiUp && pDn) read = 'new-shorts';
      else read = 'flat';
    }
    oi = {
      quality: 'REAL', venue: 'binance-perp (kho lưu trữ)',
      open: now.openInterestUsd, unit: 'USD', chg1h, chg24h, read,
      // Không có volume perp 24h cùng chợ ở đây, nên KHÔNG tính oiOverVol —
      // so OI perp với volume spot là so hai thứ khác nhau.
      squeezeWarning: false, oiOverVol: null,
      note: 'OI từ kho lưu trữ, ảnh chụp 5 phút.',
    };
  } else {
    oi = {
      quality: 'UNAVAILABLE', venue: null, open: null, unit: null,
      chg1h: null, chg24h: null, read: 'na', squeezeWarning: false, oiOverVol: null,
      note: 'N/A — kho không có metrics tại thời điểm này.',
    };
  }

  // ---- Taker perp ----
  // buildFlow() nhận các dòng {buy, sell} chứ không nhận DeltaInfo, nên dựng ở đây
  // rồi để chính buildFlow tính — cùng đường code với live.
  const perpBars = a.perp.filter((b) => b.t <= t).slice(-24);
  const perpRows = perpBars.length
    ? perpBars.map((b) => ({ buy: b.takerBuyBase, sell: Math.max(0, b.v - b.takerBuyBase) }))
    : null;

  const m = now;
  const ratioToPct = (r: number | null) => (r != null && r > 0 ? (r / (1 + r)) * 100 : null);

  return {
    deriv: {
      funding, oi,
      perpTaker: {
        quality: perpRows ? 'REAL' : 'UNAVAILABLE',
        venue: null, lastBar: null, cvd: null, cvdSeries: [],
        deltaAtPrice: [], divergence: 'none',
        note: perpRows ? 'taker perp từ kho lưu trữ' : 'N/A',
      },
    },
    perpRows,
    positioning: {
      retailLongPct: ratioToPct(m?.retailLongShortRatio ?? null),
      topLongPct: ratioToPct(m?.topLongShortRatio ?? null),
    },
  };
}
