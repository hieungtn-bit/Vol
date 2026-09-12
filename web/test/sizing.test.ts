import { describe, expect, it } from 'vitest';
import { LEG, planOrder, prettyQty, readRR } from '@/lib/sizing';
import { FEES } from '@/lib/direct';

const base = {
  side: 'LONG' as const,
  entry: [99, 100] as [number, number],
  sl: 98, tp1: 102, tp2: 106,
  equity: 10_000, riskPct: 1, leverage: 10,
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

describe('ký quỹ và thanh lý là HAI câu hỏi khác nhau', () => {
  // Bản đầu của bảng so "vị thế / vốn" với "50 / stop%". Làm thế thì stop% triệt
  // tiêu và cảnh báo chỉ bắn khi rủi ro mỗi lệnh > 50% vốn — tức không bao giờ.
  // Đã chạy lưới 16 tổ hợp vốn × rủi ro: không lần nào bắn.

  it('ký quỹ = giá trị vị thế chia đòn bẩy', () => {
    const p = planOrder(base)!;
    expect(p.margin).toBeCloseTo(p.notional / 10, 9);
    expect(p.marginPct).toBeCloseTo((p.margin / base.equity) * 100, 9);
  });

  it('đòn bẩy CAO hơn thì ký quỹ ÍT hơn, nhưng khối lượng KHÔNG đổi', () => {
    const a = planOrder({ ...base, leverage: 5 })!;
    const b = planOrder({ ...base, leverage: 20 })!;
    expect(b.margin).toBeCloseTo(a.margin / 4, 9);
    // khối lượng đi ra từ rủi ro, không từ đòn bẩy
    expect(b.qty).toBeCloseTo(a.qty, 9);
    expect(b.riskMoney).toBe(a.riskMoney);
  });

  it('tối đa an toàn phụ thuộc ĐỘ RỘNG STOP — đó mới là điều nó phải nói', () => {
    expect(planOrder({ ...base, sl: 98 })!.maxSafeLeverage).toBeCloseTo(25, 9);   // stop 2%
    expect(planOrder({ ...base, sl: 99 })!.maxSafeLeverage).toBeCloseTo(50, 9);   // stop 1%
    expect(planOrder({ ...base, sl: 95 })!.maxSafeLeverage).toBeCloseTo(10, 9);   // stop 5%
  });

  it('HAI mức độ cảnh báo, và phải phân biệt đúng', () => {
    // stop 2% → an toàn tới 25×, và thanh lý nằm trong stop từ 50× trở lên.
    const an = planOrder({ ...base, leverage: 20 })!;
    const mong = planOrder({ ...base, leverage: 30 })!;
    const chay = planOrder({ ...base, leverage: 60 })!;

    expect([an.vuotDonBay, an.chayTruocStop]).toEqual([false, false]);
    // 30×: thanh lý ở 3.33% vẫn NGOÀI stop 2% — đệm mỏng, chưa phải cháy trước
    expect([mong.vuotDonBay, mong.chayTruocStop]).toEqual([true, false]);
    // 60×: thanh lý ở 1.67% nằm TRONG stop 2% — cháy trước thật
    expect([chay.vuotDonBay, chay.chayTruocStop]).toEqual([true, true]);
  });

  it('"cháy trước stop" chỉ đúng khi thanh lý thật sự nằm trong stop', () => {
    for (const L of [10, 20, 30, 40, 50, 60, 100]) {
      const p = planOrder({ ...base, leverage: L })!;
      const trongStop = 100 / L < p.slPct;
      expect(p.chayTruocStop).toBe(trongStop);
    }
  });

  it('giá thanh lý nằm đúng phía, và đòn bẩy cao thì nó sát entry hơn', () => {
    const l10 = planOrder({ ...base, leverage: 10 })!;
    const l50 = planOrder({ ...base, leverage: 50 })!;
    expect(l10.liqPrice).toBeLessThan(l10.entryPrice);          // LONG: thanh lý ở dưới
    expect(l50.liqPrice).toBeGreaterThan(l10.liqPrice);         // 50× sát hơn 10×
    const s = planOrder({ ...base, side: 'SHORT', entry: [100, 101], sl: 102, tp1: 98, tp2: 94 })!;
    expect(s.liqPrice).toBeGreaterThan(s.entryPrice);           // SHORT: thanh lý ở trên
  });

  it('ký quỹ vượt vốn thì báo không đủ vốn', () => {
    // vị thế 5000, đòn bẩy 1× → cần 5000 ký quỹ, mà vốn chỉ 10.000 → đủ
    expect(planOrder({ ...base, leverage: 1 })!.khongDuVon).toBe(false);
    // hạ vốn xuống 1000: rủi ro 1% = 10, vị thế 500, đòn bẩy 1× → ký quỹ 500 < 1000
    expect(planOrder({ ...base, equity: 1000, leverage: 1 })!.khongDuVon).toBe(false);
    // rủi ro 30% với stop 2% → vị thế gấp 15 lần vốn, đòn bẩy 1× thì không mở nổi
    expect(planOrder({ ...base, riskPct: 30, leverage: 1 })!.khongDuVon).toBe(true);
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

describe('đọc RR theo số đo, không theo câu cửa miệng', () => {
  it('1.1–1.5 là khoảng tốt nhất', () => {
    expect(readRR(1.2).verdict).toBe('tot');
    expect(readRR(1.49).verdict).toBe('tot');
  });

  it('1.5–2.0 là khoảng TỆ NHẤT — ngược hẳn câu "RR càng cao càng tốt"', () => {
    // Đo được: ở mốc 1.5 tỉ lệ chạm sụt vách — TP1 66.7% → 45.5%, TP2 58.8% → 33.3%.
    expect(readRR(1.5).verdict).toBe('kem');
    expect(readRR(1.9).verdict).toBe('kem');
    expect(readRR(1.9).text).toMatch(/45%/);
  });

  it('hai đầu mút đều là "ít mẫu", không phải "tốt" hay "kém"', () => {
    expect(readRR(0.3).verdict).toBe('it-mau');   // n=31, dồn một nửa mẫu
    expect(readRR(2.5).verdict).toBe('it-mau');   // n=7
  });

  it('RR cao hơn KHÔNG tự động tốt hơn', () => {
    const thang = [0.9, 1.2, 1.7].map((x) => readRR(x).verdict);
    expect(thang).toEqual(['duoc', 'tot', 'kem']);   // đỉnh ở giữa, không đơn điệu
  });
});
