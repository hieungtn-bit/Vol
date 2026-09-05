import type { Candle, Derivatives, PriceAction } from '@/lib/types';

const M15 = 15 * 60_000;

export interface Spec {
  o: number; h: number; l: number; c: number; v: number;
  /** taker buy base; bỏ trống → null (ép nhánh PROXY) */
  tb?: number | null;
}

/** Dựng chuỗi nến ĐÃ ĐÓNG, mốc thời gian lùi về quá khứ để `closed` luôn đúng. */
export function mkCandles(specs: Spec[], stepMs = M15): Candle[] {
  const start = Date.now() - (specs.length + 2) * stepMs;
  return specs.map((s, i) => ({
    t: start + i * stepMs,
    o: s.o, h: s.h, l: s.l, c: s.c,
    v: s.v,
    q: s.v * s.c,
    takerBuyBase: s.tb === undefined ? null : s.tb,
    closed: true,
  }));
}

/** Nến đứng yên quanh `mid` — nền để dựng value area. */
export function flat(n: number, mid: number, vol: number, spread = 0.5): Spec[] {
  return Array.from({ length: n }, (_, i) => {
    const up = i % 2 === 0;
    return {
      o: up ? mid - spread / 2 : mid + spread / 2,
      h: mid + spread,
      l: mid - spread,
      c: up ? mid + spread / 2 : mid - spread / 2,
      v: vol,
    };
  });
}

/** Phái sinh rỗng: funding/OI/taker đều N/A. Dùng để kiểm tra luật "N/A không cộng điểm". */
export function noDerivatives(): Derivatives {
  return {
    funding: {
      quality: 'UNAVAILABLE', venue: null, rate: null, nextFundingTime: null,
      markPrice: null, flat: false, extreme: false, history: null, note: 'N/A — không dùng làm lý do.',
    },
    oi: {
      quality: 'UNAVAILABLE', venue: null, open: null, unit: null, chg1h: null, chg24h: null,
      read: 'na', squeezeWarning: false, oiOverVol: null, note: 'N/A — không dùng làm lý do.',
    },
    perpTaker: {
      quality: 'UNAVAILABLE', venue: null, lastBar: null, cvd: null, cvdSeries: [],
      deltaAtPrice: [], divergence: 'none', note: 'N/A — không dùng làm lý do.',
    },
  };
}

export const noDelta = () => ({
  quality: 'UNAVAILABLE' as const, venue: null, lastBar: null, cvd: null,
  cvdSeries: [], deltaAtPrice: [], divergence: 'none' as const,
  note: 'N/A — không dùng làm lý do.',
});
