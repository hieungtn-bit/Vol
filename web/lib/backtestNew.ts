import { DEFAULT_BT, blindDerivatives, simulate, stats, type BTOptions, type BTStats, type Trade, type TradeMeta } from './backtest';
import { buildLayers } from './layers';
import { readTF, type TFRead } from './tfRead';
import { fundingPoints } from './scan';
import type { Candle, TF } from './types';

// ============================================================
// BACKTEST TRÊN THƯỚC MỚI
//
// Ba điều kiện để con số nói ra được điều gì:
//
// 1. KHÔNG NHÌN TRỘM. Tại nến i của khung X, mọi chuỗi (15m, 1h, và chính khung
//    X) đều bị cắt theo ĐÚNG mốc đóng của nến i. Không có ngoại lệ.
// 2. CÙNG MỘT CODE QUYẾT ĐỊNH. Đi qua đúng `readTF()` mà API đang chạy.
// 3. CÙNG MỘT HÀM MÔ PHỎNG với engine cũ (`simulate`), nếu không thì hai bộ số
//    không so được — khác biệt có thể đến từ luật vào lệnh chứ không phải thuật
//    toán.
//
// Nến khung lớn được TỔNG HỢP từ 15m thay vì tải riêng. Tải riêng thì mốc đóng
// của hai chuỗi có thể lệch nhau vài giây và việc cắt lát theo thời gian sẽ âm
// thầm để lọt một nến tương lai vào cửa sổ.
// ============================================================

const MS: Record<TF, number> = {
  '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
};

/** Gộp nến 15m thành khung lớn hơn. OHLC lấy đúng, volume và taker cộng dồn. */
export function aggregate(c15: Candle[], tf: TF): Candle[] {
  if (tf === '15m') return c15;
  const w = MS[tf];
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let bucket = -1;

  for (const c of c15) {
    const b = Math.floor(c.t / w) * w;
    if (b !== bucket) {
      if (cur) out.push(cur);
      bucket = b;
      cur = { ...c, t: b };
    } else if (cur) {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
      cur.q += c.q;
      if (cur.takerBuyBase != null && c.takerBuyBase != null) cur.takerBuyBase += c.takerBuyBase;
      else cur.takerBuyBase = null;
    }
  }
  if (cur) out.push(cur);

  // Nến cuối chỉ được coi là ĐÃ ĐÓNG khi đủ số nến 15m lấp đầy nó.
  const need = w / MS['15m'];
  const lastBucket = out.length ? out[out.length - 1].t : 0;
  const filled = c15.filter((c) => Math.floor(c.t / w) * w === lastBucket).length;
  if (out.length && filled < need) out[out.length - 1] = { ...out[out.length - 1], closed: false };
  return out;
}

/** Cắt mọi chuỗi theo đúng mốc đóng của nến đang xét. */
function asOf(candles: Candle[], closeTime: number): Candle[] {
  return candles
    .filter((c) => c.t + 1 <= closeTime)
    .map((c) => (c.closed ? c : { ...c, closed: true }));
}

export interface NewSignal {
  read: TFRead;
  /** Chỉ số nến trong chuỗi của khung đang xét. */
  idx: number;
}

/**
 * Tín hiệu của thước mới tại nến `i` của khung `tf`.
 * `c15` phải là toàn bộ lịch sử 15m; hàm tự cắt lát.
 */
export function signalAtNew(
  tf: TF,
  c15All: Candle[],
  tfCandles: Candle[],
  i: number,
  scoreFloor?: number,
): TFRead | null {
  const bar = tfCandles[i];
  if (!bar) return null;
  const closeTime = bar.t + MS[tf];       // mốc nến i đóng

  const c15 = asOf(c15All, closeTime);
  if (c15.length < 100) return null;
  const c1h = aggregate(c15, '1h').filter((c) => c.closed);
  const own = asOf(tfCandles, closeTime);
  if (own.length < 10) return null;

  const layers = buildLayers(c15, c1h, closeTime);
  const c4h = aggregate(c15, '4h').filter((c) => c.closed);
  const last4h = c4h.length ? c4h[c4h.length - 1] : null;

  return readTF({
    tf, candles: own, layers, last4hClosed: last4h,
    // Backtest chạy MÙ PHÁI SINH: từ môi trường này fapi bị chặn, nên OI,
    // funding và taker perp đều N/A. Ba vế đó không được kiểm chứng ở đây.
    spotPerpAgree: false,
    fundingPoints: fundingPoints(null),
    oi: blindDerivatives().oi,
    scoreFloor,
  });
}

function metaOfRead(r: TFRead, symbol: string): TradeMeta {
  return {
    symbol, tf: r.tf,
    // Hạng cũ không còn nghĩa trên thước mới; ánh xạ theo khổ lệnh để các bảng
    // thống kê sẵn có vẫn dùng được, và ghi rõ đây là ánh xạ chứ không phải hạng.
    conviction: r.plan?.size === 'kho_du' ? 'A' : 'B',
    golden: false,
    net: r.score,
    evidence: r.lines.map((l) => ({ label: l.label, points: l.points })),
    warningCount: r.gate.fail_reasons.length,
    rrBlended: null,
    unanimous: r.lines.every((l) => l.points >= 0),
    tradeable: r.gate.pass,
  };
}

export interface NewBTResult {
  trades: Trade[];
  /** Bao nhiêu nến được xét, bao nhiêu ra được kế hoạch. */
  bars: number;
  signals: number;
  /** Vì sao các nến còn lại không ra kế hoạch — đếm theo lý do. */
  blockers: { reason: string; n: number }[];
  /** Điểm cao nhất đạt được trên mỗi nến. Để thấy sàn có với tới được không. */
  scores: number[];
  /** Vế nào thật sự bắn được, vế nào là code chết trong môi trường này. */
  lineHits: { label: string; n: number }[];
}

/** Gộp lý do về LOẠI để đếm được, bỏ phần số cụ thể. */
function kindOf(reason: string): string {
  if (reason.includes('Còn trong vùng')) return 'còn trong vùng';
  if (reason.includes('dưới sàn')) return 'điểm dưới sàn 7';
  if (reason.includes('1 ngày')) return 'khung 1 ngày không vào lệnh';
  if (reason.includes('4 giờ')) return 'khung 4 giờ chỉ lọc';
  if (reason.includes('15 phút')) return '15m ngược nến 4 giờ';
  if (reason.includes('cụm dày phía trước')) return 'không có cụm dày để chốt';
  if (reason.includes('điểm kiểm soát')) return 'cắt rơi giữa điểm kiểm soát';
  if (reason.includes('cụm mỏng')) return 'cắt/chốt rơi giữa cụm mỏng';
  if (reason.includes('lớp dài')) return 'mép lấy từ lớp dài';
  if (reason.includes('xuyên')) return 'xuyên ≥2 cụm dày';
  return reason.slice(0, 40);
}

export function runBacktestNew(
  symbol: string,
  tf: TF,
  c15All: Candle[],
  opt: BTOptions = DEFAULT_BT,
  minBars = 400,
  scoreFloor?: number,
): NewBTResult {
  const tfCandles = aggregate(c15All, tf);
  const trades: Trade[] = [];
  const tally = new Map<string, number>();
  const scores: number[] = [];
  const lineHits = new Map<string, number>();
  let busyUntil = -1;
  let bars = 0;
  let signals = 0;

  // Cần đủ lịch sử phía trước cho lớp 10 ngày (960 nến 15m).
  const startTime = c15All.length > minBars ? c15All[minBars].t : Infinity;

  for (let i = 0; i < tfCandles.length - 2; i++) {
    const bar = tfCandles[i];
    if (!bar.closed || bar.t < startTime) continue;
    if (opt.onePositionAtATime && i <= busyUntil) continue;
    bars++;

    const r = signalAtNew(tf, c15All, tfCandles, i, scoreFloor);
    if (!r) continue;
    scores.push(r.score);
    for (const l of r.lines) {
      if (l.points !== 0) lineHits.set(l.label, (lineHits.get(l.label) ?? 0) + 1);
    }
    if (!r.plan) {
      for (const x of new Set(r.gate.fail_reasons.map(kindOf))) {
        tally.set(x, (tally.get(x) ?? 0) + 1);
      }
      continue;
    }
    signals++;

    const t = simulate(
      tfCandles, i,
      { side: r.bias === 'mua' ? 'LONG' : 'SHORT', entry: r.plan.entry, sl: r.plan.sl, tp1: r.plan.tp1, tp2: r.plan.tp2 },
      opt, metaOfRead(r, symbol),
    );
    if (!t) continue;
    trades.push(t);
    busyUntil = t.exitIdx;
  }

  return {
    trades, bars, signals,
    blockers: [...tally].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    scores,
    lineHits: [...lineHits].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
  };
}

export function statsOf(t: Trade[]): BTStats { return stats(t); }
