import { describe, expect, it } from 'vitest';
import { buildFundingHistory } from '@/lib/derivatives';

/** 0.03%/kỳ — trên ngưỡng phẳng (0.02%), nên đếm là có dấu. */
const P = 0.0003;
const N = -0.0003;
const FLAT = 0.00001;

describe('lịch sử funding — cái mà bản trước vứt đi', () => {
  it('quá ít dữ liệu thì không kết luận', () => {
    expect(buildFundingHistory(null)).toBeNull();
    expect(buildFundingHistory([P])).toBeNull();
  });

  it('đếm đúng chuỗi liên tiếp cùng dấu', () => {
    const h = buildFundingHistory([N, P, P, P, P])!;
    expect(h.streak).toBe(4);
    expect(h.streakSign).toBe(1);
    expect(h.flipped).toBe(false);
  });

  it('bắt cú đảo và đếm đúng chuỗi bị bẻ — đúng ca Grok mô tả', () => {
    // sáu kỳ long trả short rồi lật sang short trả long
    const h = buildFundingHistory([P, P, P, P, P, P, N])!;
    expect(h.flipped).toBe(true);
    expect(h.brokeStreak).toBe(6);
    expect(h.streakSign).toBe(-1);
    expect(h.streak).toBe(1);
    expect(h.text).toContain('vừa ĐẢO');
    expect(h.text).toContain('6 kỳ');
  });

  it('kỳ phẳng không tính là đổi dấu — phẳng nghĩa là không ai bị ép', () => {
    const h = buildFundingHistory([P, P, P, FLAT])!;
    expect(h.streakSign).toBe(0);
    expect(h.flipped).toBe(false);      // sang phẳng không phải đảo chiều
    expect(h.brokeStreak).toBe(0);
  });

  it('đảo từ phẳng cũng không phải đảo chiều', () => {
    const h = buildFundingHistory([FLAT, FLAT, P])!;
    expect(h.flipped).toBe(false);
  });

  it('mô tả nói rõ AI trả AI, không dùng dấu toán học', () => {
    expect(buildFundingHistory([P, P, P])!.text).toContain('long trả short');
    expect(buildFundingHistory([N, N, N])!.text).toContain('short trả long');
  });

  it('giữ nguyên chuỗi rate để người đọc tự kiểm lại', () => {
    const rates = [P, N, P];
    expect(buildFundingHistory(rates)!.rates).toEqual(rates);
  });
});
