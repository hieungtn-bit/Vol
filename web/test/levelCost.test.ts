import { describe, expect, it } from 'vitest';
import { buildLongLevels, buildShortLevels, type DecideInput } from '@/lib/decide';
import { ROUND_TRIP } from '@/lib/fees';
import { analyzePriceAction } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import type { Candle } from '@/lib/types';

/** Chuỗi nến quanh 100 với biến động RẤT NHỎ — đúng hoàn cảnh ATR bé sinh ra lỗi. */
function quiet(n = 120): Candle[] {
  const out: Candle[] = [];
  const start = Date.now() - (n + 2) * 900_000;
  for (let i = 0; i < n; i++) {
    const p = 100 + Math.sin(i / 7) * 0.05;
    out.push({
      t: start + i * 900_000, o: p, h: p + 0.01, l: p - 0.01, c: p,
      v: 100, q: 100 * p, takerBuyBase: 50, closed: true,
    });
  }
  return out;
}

function inp(candles: Candle[]): DecideInput {
  const closed = candles.filter((c) => c.closed);
  const vp = computeVolumeProfile(closed, { binSize: 0.01 })!;
  return {
    symbol: 'T', tf: '15m', candles, vp,
    pa: analyzePriceAction(candles),
    delta: buildDelta(candles, vp, 'binance-spot'),
    deriv: { funding: {} as never, oi: {} as never, perpTaker: {} as never },
    htf: null, hasClosedBar: true, last: closed[closed.length - 1].c,
  };
}

describe('bậc mục tiêu phải vượt chi phí — số học, không phải tham số', () => {
  const cs = quiet();
  const i = inp(cs);

  it('thị trường lặng: bản CŨ đặt TP1 gần hơn cả phí vào-ra', () => {
    const lv = buildLongLevels(i, { costFloorMult: 0 });
    const dist = Math.abs(lv.tp1 - lv.entry[1]) / lv.entry[1];
    // Đây chính là lỗi: kèo không thể có lãi dù đi đúng hướng và chạm ngay.
    expect(dist).toBeLessThan(ROUND_TRIP);
  });

  it('bản MỚI đẩy TP1 ra xa ít nhất hai vòng phí', () => {
    const lv = buildLongLevels(i, { costFloorMult: 2 });
    const dist = Math.abs(lv.tp1 - lv.entry[1]) / lv.entry[1];
    expect(dist).toBeGreaterThanOrEqual(ROUND_TRIP * 2 * 0.999);
  });

  it('short đối xứng', () => {
    const cu = buildShortLevels(i, { costFloorMult: 0 });
    const moi = buildShortLevels(i, { costFloorMult: 2 });
    expect(Math.abs(cu.tp1 - cu.entry[0]) / cu.entry[0]).toBeLessThan(ROUND_TRIP);
    expect(Math.abs(moi.tp1 - moi.entry[0]) / moi.entry[0]).toBeGreaterThanOrEqual(ROUND_TRIP * 2 * 0.999);
  });

  it('TP2 vẫn nằm xa hơn TP1, thứ tự mốc chốt không bị đảo', () => {
    const lv = buildLongLevels(i, { costFloorMult: 2 });
    expect(lv.tp2).toBeGreaterThan(lv.tp1);
    const s = buildShortLevels(i, { costFloorMult: 2 });
    expect(s.tp2).toBeLessThan(s.tp1);
  });

  it('entry và SL KHÔNG đổi — chỉ mốc chốt đổi', () => {
    // Sàn chi phí chỉ được đụng vào bậc TP. Nếu nó nới cả stop thì đó là "nới
    // stop cho khỏi bị quét", đúng thứ bị cấm.
    const cu = buildLongLevels(i, { costFloorMult: 0 });
    const moi = buildLongLevels(i, { costFloorMult: 2 });
    expect(moi.entry).toEqual(cu.entry);
    expect(moi.sl).toBe(cu.sl);
  });

  it('thị trường động: sàn chi phí KHÔNG đụng vào gì — ATR đã lớn hơn', () => {
    const wild = quiet().map((c, k) => {
      const p = 100 + Math.sin(k / 5) * 4;
      return { ...c, o: p, h: p + 0.6, l: p - 0.6, c: p };
    });
    const j = inp(wild);
    const cu = buildLongLevels(j, { costFloorMult: 0 });
    const moi = buildLongLevels(j, { costFloorMult: 2 });
    expect(moi.tp1).toBe(cu.tp1);
    expect(moi.tp2).toBe(cu.tp2);
  });
});
