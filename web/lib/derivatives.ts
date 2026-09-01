import type {
  Candle, DeltaInfo, Derivatives, FundingInfo, OIInfo, OIRead, VolumeProfile,
} from './types';
import type { OkxSnapshot, PerpSnapshot } from './sources';

// ============================================================
// OI · Funding · Taker delta
// Luật: thiếu là ghi N/A, và N/A KHÔNG được vào danh sách lý do.
// Funding phẳng cũng không được vào danh sách lý do.
// ============================================================

const FLAT_FR = 0.0002;      // 0.02% / 8h
const EXTREME_FR = 0.0005;   // 0.05% / 8h — mới đáng gọi là lệch

export function buildFunding(perp: PerpSnapshot, okx: OkxSnapshot): FundingInfo {
  let rate: number | null = null;
  let venue: string | null = null;
  let next: number | null = null;
  let mark: number | null = null;

  if (perp.alive && perp.fundingRate != null) {
    rate = perp.fundingRate; venue = 'binance-perp';
    next = perp.nextFundingTime; mark = perp.markPrice;
  } else if (okx.fundingRate != null) {
    rate = okx.fundingRate; venue = 'okx-swap';
    next = okx.nextFundingTime; mark = okx.markPrice;
  }

  if (rate == null) {
    return {
      quality: 'UNAVAILABLE', venue: null, rate: null, nextFundingTime: null,
      markPrice: okx.markPrice ?? perp.markPrice, flat: false, extreme: false,
      note: 'N/A — không dùng làm lý do.',
    };
  }

  const flat = Math.abs(rate) < FLAT_FR;
  const extreme = Math.abs(rate) >= EXTREME_FR;
  return {
    quality: 'REAL', venue, rate, nextFundingTime: next, markPrice: mark, flat, extreme,
    note: flat
      ? `Funding phẳng (${(rate * 100).toFixed(4)}%/8h) — bỏ qua, không làm lý do.`
      : extreme
        ? `Funding lệch mạnh ${(rate * 100).toFixed(4)}%/8h (${venue}).`
        : `Funding ${(rate * 100).toFixed(4)}%/8h (${venue}) — nghiêng nhẹ, chưa đủ làm lý do chính.`,
  };
}

function pctChange(series: { t: number; oi: number }[], hoursBack: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const target = last.t - hoursBack * 3_600_000;
  let ref: { t: number; oi: number } | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].t <= target) { ref = series[i]; break; }
  }
  if (!ref) ref = series[0];
  if (!ref.oi) return null;
  return ((last.oi - ref.oi) / ref.oi) * 100;
}

export function buildOI(
  perp: PerpSnapshot,
  okx: OkxSnapshot,
  priceChg1hPct: number | null,
  priceChg24hPct: number | null,
  /** Volume 24h của CHÍNH chợ perp đang lấy OI (USD). null = không có → không tính tỷ lệ. */
  perpVol24hUsd: number | null,
): OIInfo {
  let series: { t: number; oi: number }[] | null = null;
  let openNow: number | null = null;
  let venue: string | null = null;
  let unit: string | null = null;

  if (perp.alive && perp.oiHist && perp.oiHist.length > 1) {
    series = perp.oiHist; openNow = perp.openInterest; venue = 'binance-perp'; unit = 'base coin';
  } else if (okx.oiHistUsd && okx.oiHistUsd.length > 1) {
    series = okx.oiHistUsd; openNow = okx.oiUsd; venue = 'okx-swap'; unit = 'USD';
  } else if (okx.oiUsd != null) {
    openNow = okx.oiUsd; venue = 'okx-swap'; unit = 'USD';
  }

  if (openNow == null && !series) {
    return {
      quality: 'UNAVAILABLE', venue: null, open: null, unit: null,
      chg1h: null, chg24h: null, read: 'na', squeezeWarning: false, oiOverVol: null,
      note: 'N/A — không dùng làm lý do.',
    };
  }

  const chg1h = series ? pctChange(series, 1) : null;
  const chg24h = series ? pctChange(series, 24) : null;

  // OI ↓ + giá ↓ = long cover. OI ↑ + giá ↑ = long mới. OI ↓ + giá ↑ = short cover.
  let read: OIRead = 'na';
  if (chg1h != null && priceChg1hPct != null) {
    const oiUp = chg1h > 0.5;
    const oiDn = chg1h < -0.5;
    const pUp = priceChg1hPct > 0.15;
    const pDn = priceChg1hPct < -0.15;
    if (oiDn && pDn) read = 'long-cover';
    else if (oiUp && pUp) read = 'new-longs';
    else if (oiDn && pUp) read = 'short-cover';
    else if (oiUp && pDn) read = 'new-shorts';
    else read = 'flat';
  }

  // OI/vol24h cao bất thường = cảnh báo squeeze. KHÔNG tự long/short vì "OI cao".
  // Tử số và mẫu số PHẢI cùng một chợ: so OI perp với volume spot là so hai thứ
  // khác nhau và cho ra tỷ lệ vô nghĩa. Không có volume perp thì bỏ trống, không đoán.
  let oiOverVol: number | null = null;
  if (unit === 'USD' && openNow != null && perpVol24hUsd != null && perpVol24hUsd > 0) {
    oiOverVol = openNow / perpVol24hUsd;
  }
  const squeeze = oiOverVol != null && oiOverVol > 1.5;

  return {
    quality: series ? 'REAL' : 'REAL',
    venue, open: openNow, unit, chg1h, chg24h, read,
    squeezeWarning: squeeze, oiOverVol,
    note: [
      venue ? `OI từ ${venue}${unit ? ` (${unit})` : ''}.` : '',
      chg1h != null ? `Δ1h ${chg1h >= 0 ? '+' : ''}${chg1h.toFixed(2)}%` : 'Δ1h N/A',
      chg24h != null ? `Δ24h ${chg24h >= 0 ? '+' : ''}${chg24h.toFixed(2)}%` : 'Δ24h N/A',
      squeeze ? `OI/vol24h perp = ${oiOverVol!.toFixed(2)} — cảnh báo squeeze, KHÔNG phải tín hiệu vào lệnh.` : '',
    ].filter(Boolean).join(' · '),
  };
}

export const OI_READ_VI: Record<OIRead, string> = {
  'long-cover': 'OI ↓ + giá ↓ → long cover (xả vị thế, chưa phải short mới)',
  'new-longs': 'OI ↑ + giá ↑ → long mới vào',
  'short-cover': 'OI ↓ + giá ↑ → short cover (đóng short, chưa phải long mới)',
  'new-shorts': 'OI ↑ + giá ↓ → short mới vào',
  flat: 'OI đi ngang — không đọc được gì',
  na: 'N/A',
};

// ---------------- Taker delta / CVD ----------------

/**
 * Delta của SPOT (taker buy base từ kline field 9) là số THẬT nhưng thuộc chợ spot.
 * Không bao giờ gộp nó với perp taker — hai chợ khác nhau.
 * Không có taker → dùng close-direction và gắn nhãn PROXY.
 */
export function buildDelta(
  candles: Candle[],
  vp: VolumeProfile | null,
  label: 'binance-spot' | 'proxy',
): DeltaInfo {
  const closed = candles.filter((c) => c.closed);
  if (closed.length === 0) {
    return {
      quality: 'UNAVAILABLE', venue: null, lastBar: null, cvd: null, cvdSeries: [],
      deltaAtPrice: [], divergence: 'none', note: 'N/A — không dùng làm lý do.',
    };
  }

  const hasTaker = label === 'binance-spot' && closed.every((c) => c.takerBuyBase != null);
  const perBar = closed.map((c) =>
    hasTaker ? c.takerBuyBase! - (c.v - c.takerBuyBase!) : (c.c >= c.o ? c.v : -c.v),
  );

  const cvdSeries: number[] = [];
  let acc = 0;
  for (const d of perBar) { acc += d; cvdSeries.push(acc); }

  // delta-at-price: ưu tiên hơn CVD thời gian vì nó nói AI đứng Ở ĐÂU.
  const deltaAtPrice: { price: number; delta: number }[] = [];
  if (vp) {
    const map = new Map<number, number>();
    closed.forEach((c, i) => {
      const bin = vp.bins.find((b) => c.c >= b.low && c.c < b.high);
      if (!bin) return;
      map.set(bin.mid, (map.get(bin.mid) ?? 0) + perBar[i]);
    });
    for (const [price, delta] of map) deltaAtPrice.push({ price, delta });
    deltaAtPrice.sort((a, b) => a.price - b.price);
  }

  return {
    quality: hasTaker ? 'REAL' : 'PROXY',
    venue: hasTaker ? 'binance-spot' : 'proxy',
    lastBar: perBar[perBar.length - 1],
    cvd: acc,
    cvdSeries,
    deltaAtPrice,
    divergence: findDivergence(closed, cvdSeries),
    note: hasTaker
      ? 'Taker delta THẬT nhưng của chợ SPOT (Binance). Không trộn với perp.'
      : 'PROXY — suy từ hướng đóng nến, không phải taker thật.',
  };
}

/**
 * Regular bullish: giá LL + CVD HL. Regular bearish: giá HH + CVD LH.
 * So hai nửa của cửa sổ 40 nến — không dò từng đỉnh nhỏ để tránh nhiễu.
 */
function findDivergence(
  candles: Candle[],
  cvd: number[],
): 'regular-bull' | 'regular-bear' | 'none' {
  const n = Math.min(40, candles.length);
  if (n < 12) return 'none';
  const a0 = candles.length - n;
  const mid = candles.length - Math.floor(n / 2);

  const seg = (from: number, to: number) => {
    const cs = candles.slice(from, to);
    const ds = cvd.slice(from, to);
    return {
      low: Math.min(...cs.map((c) => c.l)),
      high: Math.max(...cs.map((c) => c.h)),
      cvdLow: Math.min(...ds),
      cvdHigh: Math.max(...ds),
    };
  };
  const A = seg(a0, mid);
  const B = seg(mid, candles.length);

  if (B.low < A.low && B.cvdLow > A.cvdLow) return 'regular-bull';
  if (B.high > A.high && B.cvdHigh < A.cvdHigh) return 'regular-bear';
  return 'none';
}

export function buildDerivatives(
  perp: PerpSnapshot,
  okx: OkxSnapshot,
  priceChg1hPct: number | null,
  priceChg24hPct: number | null,
  perpVol24hUsd: number | null,
  perpTaker: { buy: number; sell: number }[] | null,
): Derivatives {
  let perpDelta: DeltaInfo;
  if (perpTaker && perpTaker.length) {
    const perBar = perpTaker.map((x) => x.buy - x.sell);
    const series: number[] = [];
    let acc = 0;
    for (const d of perBar) { acc += d; series.push(acc); }
    perpDelta = {
      quality: 'REAL', venue: null, lastBar: perBar[perBar.length - 1], cvd: acc,
      cvdSeries: series, deltaAtPrice: [], divergence: 'none',
      note: 'Taker perp (Binance USDT-M).',
    };
  } else {
    perpDelta = {
      quality: 'UNAVAILABLE', venue: null, lastBar: null, cvd: null, cvdSeries: [],
      deltaAtPrice: [], divergence: 'none',
      note: `Taker perp N/A${perp.alive ? '' : ' — ' + perp.reason} — không dùng làm lý do.`,
    };
  }

  return {
    funding: buildFunding(perp, okx),
    oi: buildOI(perp, okx, priceChg1hPct, priceChg24hPct, perpVol24hUsd),
    perpTaker: perpDelta,
  };
}
