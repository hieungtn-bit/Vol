/**
 * PHÂN PHỐI LỢI SUẤT PHÍA TRƯỚC — thuần, không fetch, không đọc đồng hồ.
 *
 * Bảng được dựng OFFLINE (scripts/bangPhanPhoi.ts) rồi commit vào repo; lúc
 * chạy, trang chỉ tính trạng thái hôm nay và tra bảng. Quét 43k nến mỗi lần có
 * người mở trang là không khả thi, mà cũng không cần: phân phối lịch sử đổi rất
 * chậm, còn trạng thái hôm nay thì tính từ vài trăm nến là đủ.
 *
 * NGUYÊN TẮC ĐỌC: một con số như "P(tăng) = 55%" tự nó vô nghĩa. Chỉ có nghĩa
 * khi đặt cạnh mốc VÔ ĐIỀU KIỆN và kèm sai số của HIỆU. Nếu hiệu nằm trong sai
 * số thì trạng thái hôm nay không nói được gì — và đó là câu trả lời hợp lệ,
 * không phải câu trả lời thiếu.
 */

export interface TomTat {
  /** Số ĐOẠN ĐỘC LẬP, không phải số nến. Xem `thua()` trong script dựng bảng. */
  n: number;
  pTang: number;
  tb: number;
  q10: number;
  q25: number;
  q50: number;
  q75: number;
  q90: number;
}

export interface ChanTroi {
  /** Số giờ nhìn về phía trước. */
  gio: number;
  ten: string;
}

export interface BangMot {
  symbol: string;
  tuNgay: string;
  denNgay: string;
  soNen: number;
  /** Ngưỡng chia ba nhóm biến động, để runtime phân ô ĐÚNG như lúc dựng bảng. */
  nguongBienDong: [number, number];
  voDieuKien: TomTat[];
  /** Khoá `${viTri}-${bienDong}`, mỗi ô là mảng theo chân trời. */
  oNhom: Record<string, TomTat[]>;
}

export interface BangPhanPhoi {
  taoLuc: number;
  nguon: string;
  chanTroi: ChanTroi[];
  bang: Record<string, BangMot>;
}

/** Cửa sổ tính trạng thái: 120 nến cho biên độ và biến động, 240 cho trung bình. */
export const CUA_SO_BIEN = 120;
export const CUA_SO_TB = 240;

export interface TrangThai {
  /** Vị trí close trong biên độ 120 cây gần nhất, 0–1. */
  viTri: number;
  /** Lệch chuẩn 120 lợi suất giờ gần nhất. */
  bienDong: number;
  /** close / SMA240 − 1. */
  soVoiTB: number;
  gia: number;
}

const tb = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function lechChuan(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = tb(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function luongTu(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function tomTat(xs: number[]): TomTat {
  return {
    n: xs.length,
    pTang: xs.filter((x) => x > 0).length / xs.length,
    tb: tb(xs),
    q10: luongTu(xs, 0.1), q25: luongTu(xs, 0.25), q50: luongTu(xs, 0.5),
    q75: luongTu(xs, 0.75), q90: luongTu(xs, 0.9),
  };
}

/**
 * Trạng thái tại cây `i`, CHỈ dùng nến tới `i`. Không lookahead — đây là điều
 * kiện để con số phía trước còn có nghĩa.
 */
export function trangThaiTai(
  c: { h: number; l: number; c: number }[], i: number,
): TrangThai | null {
  if (i < CUA_SO_TB) return null;
  const w = c.slice(i - (CUA_SO_BIEN - 1), i + 1);
  const hi = Math.max(...w.map((x) => x.h));
  const lo = Math.min(...w.map((x) => x.l));
  const r: number[] = [];
  for (let k = i - (CUA_SO_BIEN - 1); k <= i; k++) r.push(Math.log(c[k].c / c[k - 1].c));
  const sma = tb(c.slice(i - (CUA_SO_TB - 1), i + 1).map((x) => x.c));
  return {
    viTri: hi > lo ? (c[i].c - lo) / (hi - lo) : 0.5,
    bienDong: lechChuan(r),
    soVoiTB: c[i].c / sma - 1,
    gia: c[i].c,
  };
}

/**
 * Ô nhóm của một trạng thái. Lưới CỐ TÌNH thô (3×3): chia mịn hơn thì mỗi ô chỉ
 * còn vài đoạn độc lập và mọi con số đều là nhiễu.
 */
export function oCua(t: TrangThai, nguongBienDong: [number, number]): string {
  const v = t.viTri < 1 / 3 ? 0 : t.viTri < 2 / 3 ? 1 : 2;
  const b = t.bienDong < nguongBienDong[0] ? 0 : t.bienDong < nguongBienDong[1] ? 1 : 2;
  return `${v}-${b}`;
}

export const TEN_VI_TRI = ['đáy biên 5 ngày', 'giữa biên 5 ngày', 'đỉnh biên 5 ngày'];
export const TEN_BIEN_DONG = ['biến động thấp', 'biến động vừa', 'biến động cao'];

/** Sai số chuẩn của một tỷ lệ. */
export const seTyLe = (p: number, n: number) => (n > 0 ? Math.sqrt((p * (1 - p)) / n) : NaN);

export interface SoSanh {
  /** Hiệu P(tăng), tính bằng điểm phần trăm. */
  dP: number;
  seP: number;
  /** Hiệu lợi suất trung bình. */
  dTb: number;
  /** true khi hiệu vượt HAI lần sai số — chỉ khi đó mới được nói là có tín hiệu. */
  dangKe: boolean;
}

export function soSanh(a: TomTat, b: TomTat): SoSanh {
  const dP = b.pTang - a.pTang;
  const seP = Math.sqrt(seTyLe(a.pTang, a.n) ** 2 + seTyLe(b.pTang, b.n) ** 2);
  return { dP, seP, dTb: b.tb - a.tb, dangKe: Number.isFinite(seP) && Math.abs(dP) > 2 * seP };
}

/** Số đoạn độc lập tối thiểu để dám tóm tắt một ô. Dưới mức này thì nói thẳng là thiếu mẫu. */
export const TOI_THIEU = 20;
