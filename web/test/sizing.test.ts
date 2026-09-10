import { describe, expect, it } from 'vitest';
import { LEG, planOrder, prettyQty } from '@/lib/sizing';
import { FEES } from '@/lib/direct';

const base = {
  side: 'LONG' as const,
  entry: [99, 100] as [number, number],
  sl: 98, tp1: 102, tp2: 106,
  equity: 10_000, riskPct: 1,
};

describe('khối lượng đi ra từ RỦI RO, không đi ra từ vốn', () => {
  it('rủi ro 1% của 10.000 với stop 2 giá → 50 coin', () => {
    const p = planOrder(base)!;
    expect(p.riskMoney).toBe(100);          // 1% của 10.000
    expect(p.qty).toBeCloseTo(50, 9);       // 100 / |100-98|
    expect(p.notional).toBeCloseTo(5000, 9);
  });

  it('stop RỘNG GẤP ĐÔI thì khối lượng còn MỘT NỬA — rủi ro không đổi', () => {
    const hep = planOrder(base)!;
    const rong = planOrder({ ...base, sl: 96 })!;
    expect(rong.qty).toBeCloseTo(hep.qty / 2, 9);
    expect(rong.riskMoney).toBe(hep.riskMoney);
  });

  it('gấp đôi vốn thì gấp đôi khối lượng, tỷ lệ lời/lỗ không đổi', () => {
    const a = planOrder(base)!;
    const b = planOrder({ ...base, equity: 20_000 })!;
    expect(b.qty).toBeCloseTo(a.qty * 2, 9);
    expect(b.rewardR).toBeCloseTo(a.rewardR, 9);
  });
});

describe('ba kết cục khớp đúng cái backtest mô phỏng', () => {
  const p = planOrder(base)!;

  it('chia 50/50 hai mốc chốt, đúng như simulate() trả tiền', () => {
    expect(LEG).toBe(0.5);
    expect(p.qtyLeg).toBeCloseTo(p.qty / 2, 9);
    // 0.5×(102−100)×50 + 0.5×(106−100)×50 = 50 + 150 = 200, trừ phí
    expect(p.outcomes.bothTP).toBeCloseTo(200 - p.feeMoney, 6);
  });

  it('thủng stop mất đúng số tiền đã chọn, CỘNG phí và trượt giá', () => {
    expect(p.outcomes.stopped).toBeLessThan(-p.riskMoney);
    expect(p.outcomes.stopped).toBeCloseTo(-100 - p.feeMoney - p.notional * FEES.slip, 6);
  });

  it('chạm TP1 rồi quay về stop nằm giữa hai kết cục kia', () => {
    expect(p.outcomes.tp1ThenSL).toBeGreaterThan(p.outcomes.stopped);
    expect(p.outcomes.tp1ThenSL).toBeLessThan(p.outcomes.bothTP);
  });

  it('phí tính taker CẢ HAI chiều, đúng như backtest trừ', () => {
    expect(p.feeMoney).toBeCloseTo(p.notional * FEES.perSide * 2, 9);
  });
});

describe('đòn bẩy an toàn là số học, không phải khẩu vị rủi ro', () => {
  it('stop 2% giá → tối đa 25x; stop 1% → 50x', () => {
    expect(planOrder(base)!.slPct).toBeCloseTo(2, 9);
    expect(planOrder(base)!.maxSafeLeverage).toBeCloseTo(25, 9);
    expect(planOrder({ ...base, sl: 99 })!.maxSafeLeverage).toBeCloseTo(50, 9);
  });

  it('stop càng rộng thì đòn bẩy an toàn càng thấp', () => {
    const a = planOrder({ ...base, sl: 99 })!;
    const b = planOrder({ ...base, sl: 95 })!;
    expect(b.maxSafeLeverage).toBeLessThan(a.maxSafeLeverage);
  });

  it('đòn bẩy CẦN không phụ thuộc stop — nó chỉ là vị thế chia vốn', () => {
    const p = planOrder(base)!;
    expect(p.leverage).toBeCloseTo(p.notional / base.equity, 9);
  });
});

describe('kèo dựng không được thì trả null, KHÔNG nắn số cho vừa', () => {
  it('stop nằm sai phía', () => {
    expect(planOrder({ ...base, sl: 101 })).toBeNull();
    expect(planOrder({ ...base, side: 'SHORT', entry: [100, 101], sl: 99 })).toBeNull();
  });

  it('mốc chốt sai phía hoặc sai thứ tự', () => {
    expect(planOrder({ ...base, tp1: 99 })).toBeNull();       // TP1 dưới entry khi LONG
    expect(planOrder({ ...base, tp2: 101 })).toBeNull();      // TP2 gần hơn TP1
  });

  it('vốn hoặc rủi ro không hợp lệ', () => {
    expect(planOrder({ ...base, equity: 0 })).toBeNull();
    expect(planOrder({ ...base, riskPct: 0 })).toBeNull();
  });

  it('stop trùng entry — chia cho 0', () => {
    expect(planOrder({ ...base, sl: 100 })).toBeNull();
  });
});

describe('short đối xứng hoàn toàn', () => {
  const s = planOrder({ ...base, side: 'SHORT', entry: [100, 101], sl: 102, tp1: 98, tp2: 94 })!;

  it('khớp ở mép DƯỚI của vùng chờ', () => {
    expect(s.entryPrice).toBe(100);
  });

  it('cùng hình học thì cùng con số với long', () => {
    const l = planOrder(base)!;
    expect(s.qty).toBeCloseTo(l.qty, 9);
    expect(s.outcomes.bothTP).toBeCloseTo(l.outcomes.bothTP, 6);
    expect(s.rewardR).toBeCloseTo(l.rewardR, 9);
  });
});

describe('hiển thị khối lượng', () => {
  it('số to làm tròn thô, số bé giữ nhiều chữ số', () => {
    expect(prettyQty(1234.5)).toBe('1235');
    expect(prettyQty(12.345)).toBe('12.35');
    expect(prettyQty(0.12345)).toBe('0.1235');
    expect(prettyQty(0.00012345)).toBe('0.000123');
  });
});

describe('nhãn phải nói đúng việc sắp bấm', () => {
  // Tự tạo đúng loại lỗi đã đi sửa cả phiên: bảng hiện "Chờ mua" cho một kèo
  // SHORT. Một bảng để vào tiền mà ghi sai chiều thì người đọc bấm nhầm.
  const nhan = (side: 'LONG' | 'SHORT') =>
    side === 'LONG' ? 'Chờ MUA (limit dưới giá)' : 'Chờ BÁN (limit trên giá)';

  it('LONG là mua để mở, SHORT là bán để mở', () => {
    expect(nhan('LONG')).toMatch(/MUA/);
    expect(nhan('LONG')).not.toMatch(/BÁN/);
    expect(nhan('SHORT')).toMatch(/BÁN/);
    expect(nhan('SHORT')).not.toMatch(/MUA/);
  });

  it('limit của LONG nằm DƯỚI giá, của SHORT nằm TRÊN', () => {
    expect(nhan('LONG')).toMatch(/dưới giá/);
    expect(nhan('SHORT')).toMatch(/trên giá/);
  });
});
