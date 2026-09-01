import type { Candle, CandleSignal, PriceAction, StructureEvent, Swing } from './types';

// ============================================================
// Price Action
// Luật gốc: close giữ ngoài range = accept. Wick ra rồi đóng trong = grab.
// Không có chỉ báo dao động ở đây — chỉ swing, close và volume.
// ============================================================

const SWING_LOOKBACK = 3;   // fractal 3 trái / 3 phải
const EQ_TOL = 0.0015;      // 0.15% coi là bằng nhau → túi SL

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1].c;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p), Math.abs(c.l - p)));
  }
  const tail = trs.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

export function findSwings(candles: Candle[], lookback = SWING_LOOKBACK): {
  highs: Swing[];
  lows: Swing[];
} {
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true;
    let isL = true;
    for (let k = i - lookback; k <= i + lookback; k++) {
      if (k === i) continue;
      if (candles[k].h >= candles[i].h) isH = false;
      if (candles[k].l <= candles[i].l) isL = false;
    }
    if (isH) highs.push({ index: i, price: candles[i].h, type: 'H' });
    if (isL) lows.push({ index: i, price: candles[i].l, type: 'L' });
  }
  return { highs, lows };
}

/** Giá bằng nhau trong dung sai → túi thanh khoản, KHÔNG đặt SL sát sau. */
function equalLevels(swings: Swing[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < swings.length; i++) {
    for (let j = i + 1; j < swings.length; j++) {
      const a = swings[i].price;
      const b = swings[j].price;
      if (Math.abs(a - b) / ((a + b) / 2) <= EQ_TOL) {
        out.push((a + b) / 2);
      }
    }
  }
  // gộp các mức trùng
  out.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last !== undefined && Math.abs(p - last) / last <= EQ_TOL) continue;
    merged.push(p);
  }
  return merged;
}

/**
 * BOS = đóng nến thủng swing CÙNG hướng xu hướng đang chạy.
 * CHOCH = đóng nến thủng swing NGƯỢC hướng — đổi tính chất, cảnh báo sớm.
 */
function structureEvent(
  candles: Candle[],
  highs: Swing[],
  lows: Swing[],
): StructureEvent {
  const last = candles[candles.length - 1];
  if (!last) return 'NONE';
  const lastH = highs.length ? highs[highs.length - 1] : null;
  const lastL = lows.length ? lows[lows.length - 1] : null;

  const higherHighs = highs.length >= 2 && highs[highs.length - 1].price > highs[highs.length - 2].price;
  const lowerLows = lows.length >= 2 && lows[lows.length - 1].price < lows[lows.length - 2].price;

  if (lastH && last.c > lastH.price) return higherHighs ? 'BOS_UP' : 'CHOCH_UP';
  if (lastL && last.c < lastL.price) return lowerLows ? 'BOS_DOWN' : 'CHOCH_DOWN';
  return 'NONE';
}

/** Chỉ đọc tín hiệu nến khi volume ≥ median 20 — nến đẹp mà vol teo là nến rỗng. */
function candleSignal(candles: Candle[]): { sig: CandleSignal; hasVol: boolean } {
  const n = candles.length;
  if (n < 2) return { sig: 'none', hasVol: false };
  const c = candles[n - 1];
  const p = candles[n - 2];
  const vmed = median(candles.slice(-20).map((x) => x.v));
  const hasVol = c.v >= vmed;

  const body = Math.abs(c.c - c.o);
  const rng = c.h - c.l;
  if (rng <= 0) return { sig: 'none', hasVol };
  const upWick = c.h - Math.max(c.o, c.c);
  const dnWick = Math.min(c.o, c.c) - c.l;

  let sig: CandleSignal = 'none';
  if (c.h <= p.h && c.l >= p.l) sig = 'inside';
  else if (body / rng < 0.35 && dnWick > body * 1.5 && dnWick > upWick * 1.5) sig = 'pin-bull';
  else if (body / rng < 0.35 && upWick > body * 1.5 && upWick > dnWick * 1.5) sig = 'pin-bear';
  else if (c.c > c.o && c.c >= p.o && c.o <= p.c && p.c < p.o) sig = 'engulf-bull';
  else if (c.c < c.o && c.c <= p.o && c.o >= p.c && p.c > p.o) sig = 'engulf-bear';

  return { sig, hasVol };
}

export function analyzePriceAction(candlesIn: Candle[]): PriceAction {
  const candles = candlesIn.filter((c) => c.closed);
  const n = candles.length;
  const empty: PriceAction = {
    swingHighs: [], swingLows: [], lastSwingHigh: null, lastSwingLow: null,
    structure: 'NONE', equalHighs: [], equalLows: [],
    range: { high: 0, low: 0 }, rangePos: 50, signal: 'none', signalHasVolume: false,
    acceptedOutside: null, grab: null, atr: 0, volMedian20: 0, lastVol: 0,
    trendUp: false, trendDown: false,
  };
  if (n < 5) return empty;

  // Cửa sổ swing 20–50 nến gần nhất
  const win = candles.slice(-Math.min(50, n));
  const { highs, lows } = findSwings(win);

  const r20 = candles.slice(-20);
  const rHigh = Math.max(...r20.map((c) => c.h));
  const rLow = Math.min(...r20.map((c) => c.l));
  const last = candles[n - 1];
  const rangePos = rHigh > rLow ? ((last.c - rLow) / (rHigh - rLow)) * 100 : 50;

  // Range của 20 nến TRƯỚC cây cuối — dùng để phán accept vs grab.
  const prev = candles.slice(-21, -1);
  const pHigh = prev.length ? Math.max(...prev.map((c) => c.h)) : rHigh;
  const pLow = prev.length ? Math.min(...prev.map((c) => c.l)) : rLow;

  let acceptedOutside: 'up' | 'down' | null = null;
  let grab: 'up' | 'down' | null = null;
  if (last.c > pHigh) acceptedOutside = 'up';
  else if (last.c < pLow) acceptedOutside = 'down';
  else if (last.h > pHigh) grab = 'up';
  else if (last.l < pLow) grab = 'down';

  const { sig, hasVol } = candleSignal(candles);
  const vmed = median(candles.slice(-20).map((c) => c.v));

  return {
    swingHighs: highs,
    swingLows: lows,
    lastSwingHigh: highs.length ? highs[highs.length - 1].price : null,
    lastSwingLow: lows.length ? lows[lows.length - 1].price : null,
    structure: structureEvent(candles, highs, lows),
    equalHighs: equalLevels(highs),
    equalLows: equalLevels(lows),
    range: { high: rHigh, low: rLow },
    rangePos,
    signal: sig,
    signalHasVolume: hasVol,
    acceptedOutside,
    grab,
    atr: atr(candles),
    volMedian20: vmed,
    lastVol: last.v,
    trendUp: highs.length >= 2 && lows.length >= 2 &&
      highs[highs.length - 1].price > highs[highs.length - 2].price &&
      lows[lows.length - 1].price > lows[lows.length - 2].price,
    trendDown: highs.length >= 2 && lows.length >= 2 &&
      highs[highs.length - 1].price < highs[highs.length - 2].price &&
      lows[lows.length - 1].price < lows[lows.length - 2].price,
  };
}

/** Cụm wick gần một mức — SL phải nằm ngoài cụm này, không nằm giữa. */
export function wickCluster(
  candles: Candle[],
  level: number,
  side: 'above' | 'below',
  tolPct = 0.006,
): number {
  const closed = candles.filter((c) => c.closed).slice(-60);
  const hits = closed
    .map((c) => (side === 'above' ? c.h : c.l))
    .filter((p) => Math.abs(p - level) / level <= tolPct);
  if (hits.length === 0) return level;
  return side === 'above' ? Math.max(...hits) : Math.min(...hits);
}
