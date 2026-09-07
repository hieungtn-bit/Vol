import { describe, expect, it } from 'vitest';
import { asOf, derivAt, priceChg1h, utcStampToMs, type DerivArchive } from '@/lib/archiveDeriv';

const H = 3_600_000;

function mk(over: Partial<DerivArchive> = {}): DerivArchive {
  return { funding: [], metrics: [], perp: [], perp1h: [], ...over };
}

describe('đọc mốc thời gian của kho — ba bẫy đã vấp', () => {
  it('create_time của metrics là chuỗi UTC, không phải epoch, và không nhờ máy đoán múi giờ', () => {
    expect(utcStampToMs('2026-07-15 00:05:00')).toBe(Date.UTC(2026, 6, 15, 0, 5, 0));
    expect(utcStampToMs('2026-07-15T00:05:00')).toBe(Date.UTC(2026, 6, 15, 0, 5, 0));
    expect(Number.isNaN(utcStampToMs('rác'))).toBe(true);
  });
});

describe('KHÔNG NHÌN TRỘM TƯƠNG LAI — chỗ dễ hỏng lặng lẽ nhất', () => {
  const funding = [
    { t: 1000, raw: 0.0001, intervalHours: 8, rate8h: 0.0001 },
    { t: 2000, raw: 0.0002, intervalHours: 8, rate8h: 0.0002 },
    { t: 3000, raw: 0.0003, intervalHours: 8, rate8h: 0.0003 },
  ];

  it('asOf trả bản ghi gần nhất KHÔNG MUỘN HƠN t', () => {
    expect(asOf(funding, 2500)?.t).toBe(2000);
    expect(asOf(funding, 2000)?.t).toBe(2000);   // đúng mốc thì được dùng
    expect(asOf(funding, 1999)?.t).toBe(1000);   // sớm một mili giây thì chưa
    expect(asOf(funding, 999)).toBeNull();
    expect(asOf([], 5)).toBeNull();
  });

  it('kỳ funding chốt SAU thời điểm hỏi không bao giờ lọt vào', () => {
    for (const t of [1500, 2500, 2999]) {
      const d = derivAt(mk({ funding }), t);
      const used = d.deriv.funding.rate!;
      const future = funding.filter((f) => f.t > t).map((f) => f.rate8h);
      expect(future).not.toContain(used);
    }
  });

  it('lịch sử funding cũng chỉ gồm các kỳ đã chốt', () => {
    const d = derivAt(mk({ funding }), 2500);
    expect(d.deriv.funding.history?.rates).toEqual([0.0001, 0.0002]);
  });

  it('Δ giá 1h chỉ dùng nến 1h đã ĐÓNG — nến đang chạy là tin của tương lai', () => {
    const perp1h = [
      { t: 0, c: 100, v: 10, takerBuyBase: 5 },
      { t: H, c: 110, v: 10, takerBuyBase: 5 },
      { t: 2 * H, c: 999, v: 10, takerBuyBase: 5 },   // nến đang chạy tại t = 2.5h
    ];
    // tại 2.5h: nến 2H chưa đóng (đóng lúc 3H) → chỉ thấy 100 → 110
    expect(priceChg1h(mk({ perp1h }), 2.5 * H)).toBeCloseTo(10, 9);
    // tại 3h: nến 2H vừa đóng → mới thấy 110 → 999
    expect(priceChg1h(mk({ perp1h }), 3 * H)).toBeCloseTo(((999 - 110) / 110) * 100, 6);
  });

  it('nến perp dùng cho taker cũng cắt tại t', () => {
    const perp = [
      { t: 0, c: 1, v: 100, takerBuyBase: 90 },
      { t: 1000, c: 1, v: 100, takerBuyBase: 10 },
      { t: 5000, c: 1, v: 100, takerBuyBase: 0 },
    ];
    const d = derivAt(mk({ perp }), 2000);
    expect(d.perpRows).toHaveLength(2);
    expect(d.perpRows!.map((r) => r.buy)).toEqual([90, 10]);
  });
});

describe('thiếu dữ liệu thì để N/A, không điền số giả', () => {
  it('không có kỳ funding nào trước t → UNAVAILABLE, rate null', () => {
    const d = derivAt(mk({ funding: [{ t: 9999, raw: 0.001, intervalHours: 8, rate8h: 0.001 }] }), 5000);
    expect(d.deriv.funding.quality).toBe('UNAVAILABLE');
    expect(d.deriv.funding.rate).toBeNull();
    expect(d.deriv.funding.flat).toBe(false);
    expect(d.deriv.funding.extreme).toBe(false);
  });

  it('không có metrics → OI UNAVAILABLE và read = na, tức KHÔNG chấm điểm', () => {
    const d = derivAt(mk(), 5000);
    expect(d.deriv.oi.quality).toBe('UNAVAILABLE');
    expect(d.deriv.oi.read).toBe('na');
    expect(d.positioning.retailLongPct).toBeNull();
  });

  it('không có nến perp → perpRows null, không dựng dòng rỗng giả vờ có dữ liệu', () => {
    expect(derivAt(mk(), 5000).perpRows).toBeNull();
  });

  it('OI có nhưng thiếu Δ giá 1h → read vẫn là na, không đoán chiều', () => {
    const metrics = [
      { t: 0, openInterest: 100, openInterestUsd: 100, topLongShortRatio: null, retailLongShortRatio: null, takerLongShortVolRatio: null },
      { t: 5000, openInterest: 200, openInterestUsd: 200, topLongShortRatio: null, retailLongShortRatio: null, takerLongShortVolRatio: null },
    ];
    const d = derivAt(mk({ metrics }), 5000);
    expect(d.deriv.oi.quality).toBe('REAL');
    expect(d.deriv.oi.read).toBe('na');
  });
});

describe('funding quy về thang 8 giờ', () => {
  it('kỳ 4h thu 0.01% tương đương 0.02% trên thang 8h', () => {
    const d = derivAt(mk({ funding: [{ t: 0, raw: 0.0001, intervalHours: 4, rate8h: 0.0002 }] }), 10);
    expect(d.deriv.funding.rate).toBeCloseTo(0.0002, 9);
    // 0.0002 đúng bằng ngưỡng phẳng → không còn được coi là phẳng
    expect(d.deriv.funding.flat).toBe(false);
    expect(d.deriv.funding.note).toMatch(/4h/);
  });

  it('cùng một rate nguyên bản, kỳ 4h nặng gấp đôi kỳ 8h', () => {
    const f4 = derivAt(mk({ funding: [{ t: 0, raw: 0.0003, intervalHours: 4, rate8h: 0.0006 }] }), 10);
    const f8 = derivAt(mk({ funding: [{ t: 0, raw: 0.0003, intervalHours: 8, rate8h: 0.0003 }] }), 10);
    expect(f4.deriv.funding.rate! / f8.deriv.funding.rate!).toBeCloseTo(2, 9);
    expect(f4.deriv.funding.extreme).toBe(true);    // 0.06% >= 0.05%
    expect(f8.deriv.funding.extreme).toBe(false);
  });
});

describe('đọc OI giống hệt đường live', () => {
  const m = (t: number, oi: number) => ({
    t, openInterest: oi, openInterestUsd: oi,
    topLongShortRatio: 1.5, retailLongShortRatio: 3, takerLongShortVolRatio: 1,
  });
  // OI tăng > 0.5% và giá tăng > 0.15% → tiền mới vào long
  const up = [m(0, 100), m(H, 100), m(2 * H, 110)];
  const perp1h = [
    { t: 0, c: 100, v: 1, takerBuyBase: 0.5 },
    { t: H, c: 105, v: 1, takerBuyBase: 0.5 },
  ];

  it('OI ↑ + giá ↑ = new-longs', () => {
    expect(derivAt(mk({ metrics: up, perp1h }), 2 * H).deriv.oi.read).toBe('new-longs');
  });

  it('OI ↑ + giá ↓ = new-shorts', () => {
    const down = [{ t: 0, c: 100, v: 1, takerBuyBase: 0.5 }, { t: H, c: 95, v: 1, takerBuyBase: 0.5 }];
    expect(derivAt(mk({ metrics: up, perp1h: down }), 2 * H).deriv.oi.read).toBe('new-shorts');
  });

  it('tỉ lệ long/short đổi thành phần trăm long', () => {
    const d = derivAt(mk({ metrics: up, perp1h }), 2 * H);
    expect(d.positioning.topLongPct).toBeCloseTo((1.5 / 2.5) * 100, 6);
    expect(d.positioning.retailLongPct).toBeCloseTo((3 / 4) * 100, 6);
  });

  it('KHÔNG tính OI/volume: OI perp so với volume spot là hai chợ khác nhau', () => {
    const d = derivAt(mk({ metrics: up, perp1h }), 2 * H);
    expect(d.deriv.oi.oiOverVol).toBeNull();
    expect(d.deriv.oi.squeezeWarning).toBe(false);
  });
});
