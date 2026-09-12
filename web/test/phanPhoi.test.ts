/**
 * Thư viện phân phối — khoá đúng những chỗ dễ tự lừa mình.
 */
import { describe, expect, it } from 'vitest';
import bang from '../data/phan-phoi.json';
import {
  CUA_SO_TB, lechChuan, luongTu, oCua, soSanh, TOI_THIEU, tomTat, trangThaiTai,
  type BangPhanPhoi,
} from '../lib/phanPhoi';

const B = bang as unknown as BangPhanPhoi;

/** Chuỗi nến giả: giá đi lên đều, biên độ cố định. */
const chuoi = (n: number, f: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { h: c * 1.002, l: c * 0.998, c };
  });

describe('thống kê cơ bản', () => {
  it('lượng tử nội suy đúng ở hai đầu và giữa', () => {
    const xs = [0, 1, 2, 3, 4];
    expect(luongTu(xs, 0)).toBe(0);
    expect(luongTu(xs, 1)).toBe(4);
    expect(luongTu(xs, 0.5)).toBe(2);
    expect(luongTu(xs, 0.25)).toBe(1);
  });

  it('lệch chuẩn dùng mẫu (n−1), không phải tổng thể', () => {
    // [2,4,4,4,5,5,7,9]: sd tổng thể 2, sd mẫu ≈ 2.138
    expect(lechChuan([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it('tomTat đếm P(tăng) nghiêm ngặt > 0, số 0 không tính là tăng', () => {
    const t = tomTat([-1, 0, 1, 2]);
    expect(t.n).toBe(4);
    expect(t.pTang).toBe(0.5);
  });
});

describe('trạng thái — không được nhìn tương lai', () => {
  it('trả null khi chưa đủ cửa sổ', () => {
    const c = chuoi(CUA_SO_TB, (i) => 100 + i);
    expect(trangThaiTai(c, CUA_SO_TB - 1)).toBeNull();
  });

  it('chỉ dùng nến TỚI i — đổi nến phía sau không đổi kết quả', () => {
    const c = chuoi(400, (i) => 100 + i);
    const truoc = trangThaiTai(c, 300)!;
    // Đập nát toàn bộ nến sau 300.
    for (let k = 301; k < c.length; k++) { c[k] = { h: 1e6, l: 1, c: 5e5 }; }
    const sau = trangThaiTai(c, 300)!;
    expect(sau.viTri).toBeCloseTo(truoc.viTri, 12);
    expect(sau.bienDong).toBeCloseTo(truoc.bienDong, 12);
    expect(sau.soVoiTB).toBeCloseTo(truoc.soVoiTB, 12);
  });

  it('giá tăng đều thì đứng ở đỉnh biên và trên trung bình', () => {
    const c = chuoi(400, (i) => 100 + i);
    const t = trangThaiTai(c, 399)!;
    expect(t.viTri).toBeGreaterThan(0.9);
    expect(t.soVoiTB).toBeGreaterThan(0);
  });
});

describe('phân ô', () => {
  const ng: [number, number] = [0.002, 0.005];
  const t = (viTri: number, bienDong: number) => ({ viTri, bienDong, soVoiTB: 0, gia: 1 });

  it('biên dưới / giữa / trên và ba mức biến động', () => {
    expect(oCua(t(0.1, 0.001), ng)).toBe('0-0');
    expect(oCua(t(0.5, 0.003), ng)).toBe('1-1');
    expect(oCua(t(0.9, 0.009), ng)).toBe('2-2');
  });

  it('ngưỡng là cận DƯỚI đóng: đúng bằng ngưỡng thì rơi vào nhóm trên', () => {
    expect(oCua(t(0.5, 0.002), ng)).toBe('1-1');
    expect(oCua(t(0.5, 0.005), ng)).toBe('1-2');
  });
});

describe('so sánh có/vô điều kiện', () => {
  it('hiệu nhỏ trên mẫu nhỏ KHÔNG được gọi là đáng kể', () => {
    const a = { ...tomTat([1, -1, 1, -1]), n: 600, pTang: 0.51 };
    const b = { ...tomTat([1, -1, 1, -1]), n: 100, pTang: 0.57 };
    const s = soSanh(a, b);
    expect(s.dP).toBeCloseTo(0.06, 6);
    expect(s.dangKe).toBe(false);   // 6pp trên n=100 là ±~5pp → dưới 2σ
  });

  it('hiệu lớn trên mẫu lớn thì đáng kể', () => {
    const a = { ...tomTat([1, -1]), n: 2000, pTang: 0.50 };
    const b = { ...tomTat([1, -1]), n: 1500, pTang: 0.62 };
    expect(soSanh(a, b).dangKe).toBe(true);
  });
});

describe('bảng đã dựng', () => {
  it('có đủ BTC và BNB, và mỗi mã đủ 9 ô', () => {
    for (const s of ['BTCUSDT', 'BNBUSDT']) {
      expect(B.bang[s]).toBeDefined();
      expect(Object.keys(B.bang[s].oNhom)).toHaveLength(9);
    }
  });

  it('mọi ô đều đạt số đoạn độc lập tối thiểu ở mọi chân trời', () => {
    for (const s of Object.keys(B.bang)) {
      for (const [o, ds] of Object.entries(B.bang[s].oNhom)) {
        ds.forEach((d, i) => {
          expect(d.n, `${s} ô ${o} chân trời ${B.chanTroi[i].ten}`).toBeGreaterThanOrEqual(TOI_THIEU);
        });
      }
    }
  });

  it('n giảm dần khi chân trời dài ra — vì mẫu phải thưa hơn', () => {
    for (const s of Object.keys(B.bang)) {
      const v = B.bang[s].voDieuKien;
      expect(v[0].n).toBeGreaterThan(v[1].n);
      expect(v[1].n).toBeGreaterThan(v[2].n);
    }
  });

  it('lượng tử xếp đúng thứ tự trong mọi ô', () => {
    for (const s of Object.keys(B.bang)) {
      for (const ds of [...Object.values(B.bang[s].oNhom), [B.bang[s].voDieuKien].flat()]) {
        for (const d of ds) {
          expect(d.q10).toBeLessThanOrEqual(d.q25);
          expect(d.q25).toBeLessThanOrEqual(d.q50);
          expect(d.q50).toBeLessThanOrEqual(d.q75);
          expect(d.q75).toBeLessThanOrEqual(d.q90);
        }
      }
    }
  });
});
