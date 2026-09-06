import { describe, expect, it } from 'vitest';
import { P_TP1, P_TP2, RR1_EDGES, RR2_EDGES, expectancy } from '@/lib/expectancy';

describe('kỳ vọng có xác suất', () => {
  it('KHÔNG phải tỷ lệ lời/lỗ: hai kèo cùng tỷ lệ có thể khác kỳ vọng hẳn nhau', () => {
    // Cùng 0.5×rr1 + 0.5×rr2 = 1.60, nhưng một cái đặt TP1 gần (hay chạm), cái
    // kia đặt TP1 xa (ít chạm). Một thang chỉ nhìn tỷ lệ không phân biệt được.
    const gan = expectancy(0.5, 2.7, 0.05)!;
    const xa = expectancy(1.2, 2.0, 0.05)!;
    expect(0.5 * 0.5 + 0.5 * 2.7).toBeCloseTo(0.5 * 1.2 + 0.5 * 2.0, 6);
    expect(gan.net).toBeGreaterThan(xa.net);
  });

  it('kéo TP2 ra xa KHÔNG làm kỳ vọng tăng vô hạn', () => {
    const e = [2, 3, 5, 8, 15].map((rr2) => expectancy(1, rr2, 0.05)!.net);
    // ngưỡng cứng maxRRBlended cũ tồn tại chỉ để chặn đúng bệnh này
    expect(Math.max(...e)).toBeLessThan(0.35);
    expect(e[4]).toBeLessThan(0.2);
  });

  it('ô chưa đủ mẫu bị đánh dấu, và bị đặt xác suất thấp hơn quan sát', () => {
    expect(expectancy(1, 1.0, 0)!.weak).toBe(false);
    expect(expectancy(1, 5.0, 0)!.weak).toBe(true);
    // quan sát toàn mẫu ở hai ô cuối là 52.8% và 42.9% — bảng phải nằm dưới
    expect(P_TP2[3]).toBeLessThan(0.528);
    expect(P_TP2[4]).toBeLessThan(0.429);
  });

  it('p(chạm) giảm đơn điệu theo độ xa — nếu không thì bảng bị lộn ô', () => {
    for (let i = 1; i < P_TP1.length; i++) expect(P_TP1[i]).toBeLessThan(P_TP1[i - 1]);
    for (let i = 1; i < P_TP2.length; i++) expect(P_TP2[i]).toBeLessThan(P_TP2[i - 1]);
    expect(P_TP1).toHaveLength(RR1_EDGES.length - 1);
    expect(P_TP2).toHaveLength(RR2_EDGES.length - 1);
  });

  it('phí trừ thẳng vào kỳ vọng, và stop hẹp thì phí ăn hết', () => {
    const re = expectancy(1, 3, 0)!;
    const cao = expectancy(1, 3, 0.4)!;
    expect(cao.net).toBeCloseTo(re.net - 0.4, 9);
    expect(cao.net).toBeLessThan(0);
    expect(re.gross).toBeCloseTo(cao.gross, 9);   // phí không đụng vào phần gộp
  });

  it('kế hoạch hỏng (TP2 gần hơn TP1, hoặc RR âm) trả null chứ không trả số bừa', () => {
    expect(expectancy(2, 1, 0)).toBeNull();
    expect(expectancy(-1, 3, 0)).toBeNull();
    expect(expectancy(null, 3, 0)).toBeNull();
    expect(expectancy(1, null, 0)).toBeNull();
  });

  it('công thức đúng bằng ba nhánh mà simulate() trả tiền', () => {
    const rr1 = 1, rr2 = 3;
    const e = expectancy(rr1, rr2, 0)!;
    const p1 = e.pTP1, p2 = e.pTP2;
    const tay = p1 * (p2 * (0.5 * rr1 + 0.5 * rr2) + (1 - p2) * (0.5 * rr1 - 0.5)) + (1 - p1) * -1;
    expect(e.gross).toBeCloseTo(tay, 9);
  });

  it('câu hiện lên màn hình nói cả kỳ vọng lẫn xác suất, không chỉ một con số', () => {
    const t = expectancy(1, 3, 0.05)!.text;
    expect(t).toMatch(/R kỳ vọng/);
    expect(t).toMatch(/thắng \d+%/);
    expect(t).toMatch(/TP1 \d+%/);
  });
});

describe('thắng nhiều mà vẫn lỗ thì phải nói ra lý do', () => {
  it('mục tiêu quá sát + phí nặng: thắng >50% nhưng kỳ vọng âm', () => {
    // Đúng hình dạng gặp thật trên màn hình: TP1 và TP2 đều rất gần, stop 1R.
    const e = expectancy(0.1, 0.16, 0.28)!;
    expect(e.pWin).toBeGreaterThan(0.5);
    expect(e.net).toBeLessThan(0);
    expect(e.winsButLoses).toBe(true);
    // "thắng 61%" đứng cạnh "−0.54R" đọc như mâu thuẫn — câu giải thích phải có
    expect(e.text).toMatch(/mỗi lần thua là −1R/);
  });

  it('kèo bình thường thì không gắn câu đó vào', () => {
    const e = expectancy(1, 3, 0.05)!;
    expect(e.winsButLoses).toBe(false);
    expect(e.text).not.toMatch(/mỗi lần thua/);
  });

  it('lỗ mà thắng dưới nửa thì cũng không cần câu đó — không có gì mâu thuẫn', () => {
    const e = expectancy(2, 5, 0.1)!;
    if (e.net < 0) expect(e.pWin > 0.5 ? e.winsButLoses : true).toBe(true);
    expect(e.winsButLoses).toBe(e.net < 0 && e.pWin > 0.5);
  });
});
