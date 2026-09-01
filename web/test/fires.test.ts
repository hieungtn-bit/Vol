import { describe, expect, it } from 'vitest';
import { decideBias } from '@/lib/decide';
import { analyzePriceAction } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import { mkCandles, noDerivatives, type Spec } from './fixtures';
import type { Derivatives } from '@/lib/types';

// Hợp lưu đủ 4 mảnh: mép VP + mép PA + nến đóng xác nhận có volume + OI đồng hướng.
// Test này tồn tại để chắc chắn nhánh ≥7 KHÔNG phải code chết — nếu ngưỡng bị siết
// tới mức không bao giờ đạt thì hệ chỉ còn là cái máy in chữ WAIT.
function derivShortAligned(): Derivatives {
  const base = noDerivatives();
  return {
    ...base,
    oi: {
      quality: 'REAL', venue: 'okx-swap', open: 1e8, unit: 'USD',
      chg1h: 3.2, chg24h: 6.0, read: 'new-shorts',
      squeezeWarning: false, oiOverVol: 0.4,
      note: 'OI từ okx-swap (USD). Δ1h +3.20% · Δ24h +6.00%',
    },
  };
}

describe('setup đủ hợp lưu', () => {
  const specs: Spec[] = [];
  // Nhà lớn ở 100 (POC), vùng mỏng 101–103, và một node ở 104 nơi giá đang đứng.
  // Khoảng mỏng ở giữa chính là thứ cho TP1 có chỗ để chạy — bậc kế tiếp là POC,
  // không phải cái bin ngay cạnh entry.
  for (let i = 0; i < 30; i++) specs.push({ o: 100, h: 100.4, l: 99.6, c: 100, v: 200, tb: 100 });
  for (let i = 0; i < 12; i++) {
    const c = 101 + (i % 3);
    specs.push({ o: c, h: c + 0.3, l: c - 0.3, c, v: 60, tb: 30 });
  }
  for (let i = 0; i < 20; i++) specs.push({ o: 104, h: 104.3, l: 103.7, c: 104, v: 200, tb: 105 });
  specs.push({ o: 103.5, h: 104.2, l: 103.4, c: 104.0, v: 180, tb: 100 });   // nến xanh cuối cùng
  specs.push({ o: 104.1, h: 104.8, l: 103.2, c: 103.4, v: 600, tb: 150 });   // engulf giảm, wick trên VAH

  const candles = mkCandles(specs);
  const closed = candles.filter((c) => c.closed);
  const vp = computeVolumeProfile(closed, { binSize: 0.2 })!;
  const pa = analyzePriceAction(candles);
  const last = closed[closed.length - 1].c;

  const inp = {
    symbol: 'TESTUSDT', tf: '15m' as const, candles, vp, pa,
    delta: buildDelta(candles, vp, 'binance-spot'),
    deriv: derivShortAligned(),
    htf: null, hasClosedBar: true, last,
  };

  it('nến cuối là engulf giảm có volume ≥ median 20', () => {
    expect(pa.signal).toBe('engulf-bear');
    expect(pa.signalHasVolume).toBe(true);
  });

  it('đạt score ≥ 7 và phát SHORT', () => {
    const rec = decideBias(inp);
    expect(rec.confluence.score).toBeGreaterThanOrEqual(7);
    expect(rec.bias).toBe('SHORT');
  });

  it('mọi mức xếp đúng hình short và RR TP1 ≥ 1.2', () => {
    const rec = decideBias(inp);
    expect(rec.sl!).toBeGreaterThan(rec.entry![1]);
    expect(rec.tp1!).toBeLessThan(rec.entry![0]);
    expect(rec.tp2!).toBeLessThan(rec.tp1!);
    expect(rec.rr1!).toBeGreaterThanOrEqual(1.2);
    expect(rec.tp1!).toBeGreaterThanOrEqual(vp.va70.low);
    expect(rec.tp1!).toBeLessThanOrEqual(vp.va70.high);
  });

  it('OI đồng hướng có mặt trong bảng điểm và trong lý do', () => {
    const rec = decideBias(inp);
    expect(rec.confluence.lines.some((l) => l.label.startsWith('OI đồng hướng'))).toBe(true);
    expect(rec.reasons.some((r) => r.startsWith('OI:'))).toBe(true);
  });

  it('cùng setup nhưng TF lớn ngược hướng → counter-trend, size Small', () => {
    const rec = decideBias({
      ...inp,
      htf: { bias: 'LONG', trendUp: true, trendDown: false, rangeHigh: 106, rangeLow: 95, tf: '1h' },
    });
    if (rec.bias === 'SHORT') {
      expect(rec.counterTrend).toBe(true);
      expect(rec.size).toBe('Small');
      expect(rec.planText).toContain('counter-trend');
    } else {
      // TF lớn ngược trừ 1.5 điểm — rơi dưới 7 thì WAIT cũng là kết quả đúng luật
      expect(rec.bias).toBe('WAIT');
    }
  });

  it('cùng setup nhưng chưa có nến đóng của TF → WAIT', () => {
    expect(decideBias({ ...inp, tf: '1h', hasClosedBar: false }).bias).toBe('WAIT');
  });
});
