import { describe, expect, it } from 'vitest';
import { asOfRow, toMs } from '@/lib/archive';
import { barDelta } from '@/lib/deltaDiv';

describe('chuẩn hoá đơn vị timestamp — bẫy micro/mili giữa spot và futures', () => {
  it('futures dùng mili (13 chữ số), giữ nguyên', () => {
    expect(toMs(1788220800000)).toBe(1788220800000);
  });
  it('spot trong kho dùng MICRO (16 chữ số), phải chia 1000', () => {
    expect(toMs(1788220800000000)).toBe(1788220800000);
  });
  it('giây thì nhân 1000', () => {
    expect(toMs(1788220800)).toBe(1788220800000);
  });
  it('hai chuỗi cùng một mốc thật phải quy về cùng một số', () => {
    expect(toMs(1788220800000000)).toBe(toMs(1788220800000));
  });
});

describe('tra dữ liệu theo thời điểm — không được lấy hàng của tương lai', () => {
  const rows = [{ t: 10 }, { t: 20 }, { t: 30 }, { t: 40 }];
  it('lấy đúng hàng gần nhất không vượt quá mốc', () => {
    expect(asOfRow(rows, 25)!.t).toBe(20);
    expect(asOfRow(rows, 30)!.t).toBe(30);
    expect(asOfRow(rows, 39)!.t).toBe(30);
  });
  it('trước mọi hàng thì trả null, không lấy hàng đầu tiên', () => {
    expect(asOfRow(rows, 5)).toBeNull();
  });
  it('dùng được với funding (calcTime) chứ không chỉ t', () => {
    const f = [{ calcTime: 100 }, { calcTime: 200 }];
    expect(asOfRow(f, 150)!.calcTime).toBe(100);
    expect(asOfRow(f, 99)).toBeNull();
  });
});

describe('công thức delta phải khớp định nghĩa của engine', () => {
  it('delta = 2·taker_buy_volume − volume', () => {
    // Hàng thật từ kho: ENAUSDT 1h 2026-09-01
    //   volume 74598153, taker_buy_volume 35993481
    const c = { t: 0, o: 0.14946, h: 0.15292, l: 0.14915, c: 0.15087,
      v: 74598153, q: 11294949.55077, takerBuyBase: 35993481, closed: true };
    expect(barDelta(c)).toBe(2 * 35993481 - 74598153);
    expect(barDelta(c)).toBeLessThan(0);   // taker mua < một nửa → delta âm
  });
});
