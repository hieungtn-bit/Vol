import { describe, expect, it } from 'vitest';
import { fmtTick } from '@/lib/format';

describe('số chữ số thập phân theo độ lớn giá', () => {
  it('tài sản nghìn đô không hiện năm số lẻ', () => {
    // Lỗi cũ: UI gọi fmtPrice(price, 0.0001) cho mọi mã → BTC ra "79631.86000".
    expect(fmtTick(79631.86)).toBe('79631.86');
  });
  it('altcoin lẻ vẫn đủ số để phân biệt mức giá', () => {
    expect(fmtTick(0.1635)).toBe('0.16350');
    expect(fmtTick(0.00001234)).toBe('0.000012');
  });
  it('bậc trung gian', () => {
    expect(fmtTick(123.456789)).toBe('123.457');
    expect(fmtTick(2.3456789)).toBe('2.3457');
  });
  it('số âm và số không hợp lệ', () => {
    expect(fmtTick(-1500.5)).toBe('-1500.50');
    expect(fmtTick(null)).toBe('N/A');
    expect(fmtTick(Number.NaN)).toBe('N/A');
    expect(fmtTick(Number.POSITIVE_INFINITY)).toBe('N/A');
  });
});
