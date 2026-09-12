/**
 * Cảnh báo sớm — khoá đúng những chỗ dễ trôi.
 *
 * Luật đã đo (bench/canh-bao-som.txt, 6 mã × 5 năm, nến 1H):
 *   Giá cách trung bình 168 giờ quá ngưỡng phân vị 90 của CHÍNH MÃ ĐÓ →
 *   khả năng có cú dịch chuyển lớn trong 24h tới gấp 3.0–13.4 lần mức nền,
 *   xác nhận trên nửa sau mẫu, đúng trên CẢ SÁU mã.
 */
import { describe, expect, it } from 'vitest';
import bang from '../data/canh-bao.json';
import {
  bienDongToi, dacTrungTai, danhGiaCanhBao, NEN_TANG,
  type BangCanhBao, type NenToiThieu,
} from '../lib/canhBao';

const B = bang as unknown as BangCanhBao;

/** Chuỗi nến phẳng quanh `p`, đủ dài để tính đặc trưng. */
const phang = (n: number, p = 100): NenToiThieu[] =>
  Array.from({ length: n }, () => ({ h: p * 1.001, l: p * 0.999, c: p, v: 1000 }));

describe('đặc trưng — không nhìn tương lai', () => {
  it('trả null khi chưa đủ cửa sổ nền', () => {
    expect(dacTrungTai(phang(NEN_TANG), NEN_TANG - 1)).toBeNull();
  });

  it('đổi nến PHÍA SAU không đổi đặc trưng tại i', () => {
    const c = phang(400).map((x, i) => ({ ...x, c: 100 + i * 0.1, h: 100 + i * 0.1 + 0.2, l: 100 + i * 0.1 - 0.2 }));
    const truoc = dacTrungTai(c, 300)!;
    for (let k = 301; k < c.length; k++) c[k] = { h: 1e6, l: 1, c: 5e5, v: 9e9 };
    const sau = dacTrungTai(c, 300)!;
    expect(sau.xaTrungBinh).toBeCloseTo(truoc.xaTrungBinh, 12);
    expect(sau.nenVol).toBeCloseTo(truoc.nenVol, 12);
  });

  it('chuỗi phẳng thì khoảng cách tới trung bình bằng 0', () => {
    expect(dacTrungTai(phang(400), 399)!.xaTrungBinh).toBeCloseTo(0, 12);
  });
});

describe('sự kiện = dịch chuyển lớn nhất CẢ HAI PHÍA', () => {
  it('đâm xuống rồi quay về đúng chỗ cũ vẫn là một sự kiện', () => {
    const c = phang(10);
    c[5] = { h: 100, l: 80, c: 100, v: 1 };   // thủng 20% rồi đóng lại chỗ cũ
    // Lợi suất cuối kỳ bằng 0, nhưng người đang cầm lệnh thì đã ăn đủ.
    expect(bienDongToi(c, 0, 8)!).toBeCloseTo(0.2, 6);
  });

  it('trả null khi không đủ nến phía trước', () => {
    expect(bienDongToi(phang(10), 5, 8)).toBeNull();
  });
});

describe('đánh giá lúc chạy', () => {
  it('mã CHƯA hiệu chuẩn thì không cảnh báo — không mượn ngưỡng mã khác', () => {
    const r = danhGiaCanhBao(phang(400), 'KHONGCOTHAT', B);
    expect(r.muc).toBe('chua-hieu-chuan');
    expect(r.nguong).toBeNull();
    expect(r.cau).toContain('bịa');
  });

  it('giá sát trung bình → không cảnh báo, nhưng vẫn nói mức nền', () => {
    const r = danhGiaCanhBao(phang(400), 'BTCUSDT', B);
    expect(r.muc).toBe('khong');
    expect(r.xa!).toBeLessThan(r.nguong!);
    expect(r.cau).toMatch(/mức nền/i);
  });

  it('giá kéo xa trung bình quá ngưỡng → cảnh báo, kèm số đo ngoài mẫu', () => {
    // Đi ngang rồi bật mạnh ở cuối để đẩy |c/SMA168 − 1| vượt ngưỡng BTC (7.8%).
    const c = phang(400);
    for (let i = 380; i < 400; i++) {
      const p = 100 * (1 + 0.012 * (i - 379));
      c[i] = { h: p * 1.001, l: p * 0.999, c: p, v: 1000 };
    }
    const r = danhGiaCanhBao(c, 'BTCUSDT', B);
    expect(r.muc).toBe('cao');
    expect(r.xa!).toBeGreaterThan(r.nguong!);
    expect(r.do!.gapNen).toBeGreaterThan(1);
    // Câu phải nói rõ đây là ĐỘ LỚN, không phải hướng.
    expect(r.cau).toContain('ĐỘ LỚN, không phải hướng');
    expect(r.cau).toContain('gấp');
  });

  it('thiếu nến thì nói thiếu, không đoán', () => {
    const r = danhGiaCanhBao(phang(50), 'BTCUSDT', B);
    expect(r.muc).toBe('chua-hieu-chuan');
    expect(r.cau).toContain('Chưa đủ');
  });
});

describe('bảng hiệu chuẩn đã đo', () => {
  it('có đủ sáu mã và mọi ngưỡng đều dương', () => {
    expect(Object.keys(B.ma).length).toBeGreaterThanOrEqual(6);
    for (const [m, h] of Object.entries(B.ma)) {
      expect(h.nguong, m).toBeGreaterThan(0);
      expect(h.nNgoaiMau, m).toBeGreaterThan(0);
    }
  });

  it('MỌI mã đều gấp nền > 1 ở nửa sau — luật không phải do vài mã kéo', () => {
    for (const [m, h] of Object.entries(B.ma)) {
      expect(h.gapNen, `${m} gấp nền`).toBeGreaterThan(1);
    }
  });

  it('ngưỡng chênh nhau rõ giữa các mã — nên không được dùng ngưỡng chung', () => {
    const ng = Object.values(B.ma).map((h) => h.nguong);
    expect(Math.max(...ng) / Math.min(...ng)).toBeGreaterThan(2);
  });
});

describe('cửa sổ tối thiểu — lỗi đã gặp trên production', () => {
  it('ĐÚNG 168 nến đã đóng là CHƯA đủ; phải có 169', () => {
    // LIMIT['1h'] = 168 nên chuỗi giao cho `danhGiaCanhBao` chỉ có 168 cây đã
    // đóng, mà `dacTrungTai(c, c.length-1)` cần chỉ số ≥ 168 — tức 169 cây.
    // Production vì thế in "Chưa đủ 168 nến 1H" cho MỌI mã.
    expect(danhGiaCanhBao(phang(NEN_TANG), 'BTCUSDT', B).muc).toBe('chua-hieu-chuan');
    expect(danhGiaCanhBao(phang(NEN_TANG + 1), 'BTCUSDT', B).muc).not.toBe('chua-hieu-chuan');
  });
});
