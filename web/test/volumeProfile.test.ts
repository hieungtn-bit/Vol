import { describe, expect, it } from 'vitest';
import { computeVolumeProfile, hvnCrossings, inMidValue } from '@/lib/volumeProfile';
import { mkCandles, type Spec } from './fixtures';

describe('computeVolumeProfile', () => {
  it('POC rơi đúng bin có volume lớn nhất trên fixture 20 nến', () => {
    // 20 nến: 16 nến đóng quanh 100.00, 4 nến đóng quanh 102.00 nhưng volume nhỏ.
    // POC phải là ~100, không phải giá gần nhất hay giá trung bình.
    const specs: Spec[] = [];
    for (let i = 0; i < 16; i++) {
      specs.push({ o: 99.9, h: 100.4, l: 99.6, c: 100.0, v: 100 });
    }
    for (let i = 0; i < 4; i++) {
      specs.push({ o: 101.9, h: 102.3, l: 101.7, c: 102.0, v: 10 });
    }
    const vp = computeVolumeProfile(mkCandles(specs), { binSize: 0.1 })!;

    expect(vp).toBeTruthy();
    expect(vp.candles).toBe(20);
    expect(Math.abs(vp.poc - 100.0)).toBeLessThanOrEqual(vp.binSize);
    // VA70 phải ôm lấy cụm 100, không kéo tới 102
    expect(vp.va70.low).toBeLessThanOrEqual(100.0);
    expect(vp.va70.high).toBeLessThan(101.5);
    expect(vp.va70.coverage).toBeGreaterThanOrEqual(0.7);
  });

  it('mode range rải volume, POC vẫn nằm trong vùng giao dịch dày nhất', () => {
    const specs: Spec[] = [
      ...Array.from({ length: 12 }, () => ({ o: 50, h: 50.5, l: 49.5, c: 50, v: 200 })),
      ...Array.from({ length: 4 }, () => ({ o: 55, h: 56, l: 54, c: 55, v: 20 })),
    ];
    const vp = computeVolumeProfile(mkCandles(specs), { mode: 'range', binSize: 0.25 })!;
    expect(vp.mode).toBe('range');
    expect(vp.poc).toBeGreaterThan(49);
    expect(vp.poc).toBeLessThan(51);
  });

  it('nến chưa đóng bị loại khỏi profile', () => {
    const cs = mkCandles(flat20());
    cs.push({ t: Date.now(), o: 200, h: 260, l: 200, c: 250, v: 100000, q: 0, takerBuyBase: null, closed: false });
    const vp = computeVolumeProfile(cs, { binSize: 0.1 })!;
    expect(vp.candles).toBe(20);
    expect(vp.poc).toBeLessThan(150);   // cây 250 khổng lồ không được kéo POC
  });

  it('inMidValue chặn đúng lõi VA và tha cho hai mép', () => {
    const vp = computeVolumeProfile(mkCandles(flat20()), { binSize: 0.1 })!;
    const mid = (vp.va70.low + vp.va70.high) / 2;
    expect(inMidValue(vp, mid)).toBe(true);
    expect(inMidValue(vp, vp.va70.low)).toBe(false);
    expect(inMidValue(vp, vp.va70.high)).toBe(false);
  });

  it('hvnCrossings đếm được số bậc phải xuyên', () => {
    const vp = computeVolumeProfile(mkCandles(flat20()), { binSize: 0.1 })!;
    expect(hvnCrossings(vp, 0, 1e9)).toBe(vp.hvn.length);
    expect(hvnCrossings(vp, 100, 100)).toBe(0);
  });
});

function flat20(): Spec[] {
  return Array.from({ length: 20 }, (_, i) => ({
    o: 100 + (i % 2 ? 0.1 : -0.1), h: 100.4, l: 99.6,
    c: 100 + (i % 2 ? -0.1 : 0.1), v: 100,
  }));
}
