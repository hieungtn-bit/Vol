import { describe, expect, it } from 'vitest';
import { applyGate, feeShareOf, gateLabel, passes, score, walkForward, type Gate } from '@/lib/optimize';
import { FEES } from '@/lib/direct';
import type { Trade } from '@/lib/backtest';

const t = (o: Partial<Trade> = {}): Trade => ({
  symbol: 'X', tf: '1h', side: 'LONG', conviction: 'B', golden: false, net: 20,
  signalIdx: 0, signalTime: 0, entryIdx: 1, entry: 100, sl: 98, tp1: 102, tp2: 106,
  exitIdx: 5, exitReason: 'tp2', hitTP1: true, hitTP2: true,
  r: 1, rGross: 1.1, costR: 0.1, evidence: [], warningCount: 0,
  rrBlended: 1, slPct: 2, entryDistPct: 0.5, unanimous: true, tradeable: true,
  ...o,
});

describe('phí quy ra R phải tính từ độ rộng stop, không từ kết quả', () => {
  it('không dùng costR — trường đó phụ thuộc vào việc lệnh có dính stop hay không', () => {
    // Hai lệnh cùng stop 2% nhưng một cái thoát bằng SL (costR cao hơn vì trượt
    // giá). Bộ lọc phải coi chúng NHƯ NHAU, nếu không là lọc theo kết quả.
    const a = t({ exitReason: 'tp2', costR: 0.06 });
    const b = t({ exitReason: 'sl', costR: 0.07 });
    expect(feeShareOf(a)).toBe(feeShareOf(b));
  });

  it('tỉ lệ nghịch với độ rộng stop', () => {
    expect(feeShareOf(t({ slPct: 1 }))).toBeCloseTo(feeShareOf(t({ slPct: 2 })) * 2, 10);
  });

  it('khớp đúng công thức phí đang dùng trong engine', () => {
    expect(feeShareOf(t({ slPct: 1 }))).toBeCloseTo((FEES.perSide * 2 + FEES.slip) * 100, 10);
  });

  it('stop bằng 0 thì coi như phí vô hạn, không lọt cửa nào', () => {
    expect(feeShareOf(t({ slPct: 0 }))).toBe(Infinity);
    expect(passes(t({ slPct: 0 }), { minConviction: 'C', unanimousOnly: false, maxRRBlended: null, minRRBlended: null, maxFeeShare: 0.1, minNet: null })).toBe(false);
  });
});

describe('bộ luật chọn lệnh', () => {
  const open: Gate = { minConviction: 'C', unanimousOnly: false, maxRRBlended: null, minRRBlended: null, maxFeeShare: null, minNet: null };

  it('cửa mở hết thì giữ nguyên mọi lệnh', () => {
    const xs = [t(), t({ conviction: 'C' }), t({ unanimous: false })];
    expect(applyGate(xs, open)).toHaveLength(3);
  });

  it('từng điều kiện lọc đúng thứ nó nói', () => {
    expect(applyGate([t({ conviction: 'C' }), t({ conviction: 'A' })], { ...open, minConviction: 'B' })).toHaveLength(1);
    expect(applyGate([t({ unanimous: false }), t()], { ...open, unanimousOnly: true })).toHaveLength(1);
    expect(applyGate([t({ rrBlended: 2 }), t({ rrBlended: 1 })], { ...open, maxRRBlended: 1.5 })).toHaveLength(1);
    expect(applyGate([t({ net: 5 }), t({ net: 40 })], { ...open, minNet: 20 })).toHaveLength(1);
    expect(applyGate([t({ slPct: 0.5 }), t({ slPct: 3 })], { ...open, maxFeeShare: 0.1 })).toHaveLength(1);
  });

  it('nhãn đọc được và liệt kê đúng các điều kiện đang bật', () => {
    const l = gateLabel({ ...open, minConviction: 'B', unanimousOnly: true, maxRRBlended: 1.5 });
    expect(l).toContain('≥B');
    expect(l).toContain('nhất trí');
    expect(l).toContain('Rkv≤1.5');
    expect(l).not.toContain('phí');
  });
});

describe('điểm so sánh không được thưởng cho mẫu bé', () => {
  it('dưới sàn số lệnh thì loại thẳng', () => {
    expect(score([t({ r: 5 }), t({ r: 5 })], 10)).toBe(-Infinity);
  });

  it('cùng avgR thì mẫu lớn hơn được điểm cao hơn', () => {
    const few = Array.from({ length: 20 }, () => t({ r: 0.2 }));
    const many = Array.from({ length: 200 }, () => t({ r: 0.2 }));
    expect(score(many, 10)).toBeGreaterThan(score(few, 10));
  });

  it('avgR âm cho điểm âm', () => {
    expect(score(Array.from({ length: 50 }, () => t({ r: -0.3 })), 10)).toBeLessThan(0);
  });
});

describe('walk-forward không được để tham số nhìn thấy đoạn test', () => {
  /** Nửa đầu: lệnh hạng A lời. Nửa sau: ĐẢO NGƯỢC, hạng A lỗ. */
  const flip: Trade[] = [];
  for (let i = 0; i < 400; i++) {
    const late = i >= 200;
    const isA = i % 2 === 0;
    flip.push(t({
      signalTime: i * 3_600_000,
      conviction: isA ? 'A' : 'C',
      net: isA ? 40 : 5,
      r: isA ? (late ? -1 : 1) : (late ? 1 : -1),
    }));
  }

  const baseline: Gate = { minConviction: 'A', unanimousOnly: false, maxRRBlended: null, minRRBlended: null, maxFeeShare: null, minNet: null };

  it('chọn tham số trên quá khứ, và ĂN ĐỦ hậu quả khi thị trường đảo', () => {
    const wf = walkForward(flip, { folds: 4, minTrades: 10, baseline });
    expect(wf.folds.length).toBeGreaterThan(0);
    // Nếu hàm này lỡ nhìn vào đoạn test, nó đã tránh được cú đảo và ra lãi.
    // Đúng thì nó phải lỗ ở các đoạn sau — đó mới là hành vi trung thực.
    const late = wf.folds.filter((f) => f.fold >= 3);
    expect(late.some((f) => f.test.avgR < 0)).toBe(true);
  });

  it('mỗi đoạn test đứng sau đoạn train của chính nó', () => {
    const wf = walkForward(flip, { folds: 4, minTrades: 10, baseline });
    for (const f of wf.folds) expect(f.trainN).toBeGreaterThan(0);
    for (let i = 1; i < wf.folds.length; i++) {
      expect(wf.folds[i].trainN).toBeGreaterThan(wf.folds[i - 1].trainN);
    }
  });

  it('đếm được số lần bộ luật bị đổi — đổi liên tục là dấu hiệu không ổn định', () => {
    const wf = walkForward(flip, { folds: 4, minTrades: 10, baseline });
    expect(wf.switches).toBeGreaterThanOrEqual(0);
    expect(wf.switches).toBeLessThanOrEqual(wf.folds.length);
  });
});
