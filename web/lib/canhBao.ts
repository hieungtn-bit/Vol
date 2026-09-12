/**
 * CẢNH BÁO SỚM — phát hiện "sắp có cú lớn", không phải "sắp đi hướng nào".
 *
 * Phân biệt này là điểm mấu chốt. Toàn bộ `warnings` hiện có trong hệ là cảnh
 * báo CHẤT LƯỢNG KÈO (TP1 ngoài VA, stop quá hẹp, ngược cấu trúc) — chúng mô tả
 * cái setup đang cầm, không báo trước điều gì về thị trường. Chưa cái nào từng
 * được đo.
 *
 * File này làm việc khác: đo xem một trạng thái NÉN có báo trước được một cú
 * biến động lớn hay không. Hướng thì đã có năm năm bằng chứng là không đoán
 * được (xem /phan-tich); nhưng ĐỘ LỚN thì là một câu hỏi khác, và nó có thể trả
 * lời được — vì biến động có tính bầy đàn theo thời gian còn hướng thì không.
 *
 * Thuần: không fetch, không đọc đồng hồ. Mọi đặc trưng tại `i` chỉ dùng nến tới
 * `i`, để con số phía trước còn nghĩa.
 */

export interface NenToiThieu {
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Cửa sổ ngắn (1 ngày) so với cửa sổ nền (1 tuần) — đơn vị là nến 1H. */
export const NGAN = 24;
export const NEN_TANG = 168;

export interface DacTrung {
  /** Lệch chuẩn 24 giờ / lệch chuẩn 168 giờ. < 1 = đang nén. */
  nenVol: number;
  /** Biên độ 24 giờ / biên độ 24 giờ trung bình của tuần. < 1 = nén. */
  nenBienDo: number;
  /** Khối lượng 24 giờ / trung bình tuần. < 1 = cạn thanh khoản. */
  nenVol24: number;
  /** |close / SMA168 − 1|. Xa trung bình = đã căng sẵn. */
  xaTrungBinh: number;
  /**
   * `xaTrungBinh` chia cho lệch chuẩn giờ của chính mã — khoảng cách tới trung
   * bình tính bằng ĐƠN VỊ BIẾN ĐỘNG CỦA CHÍNH NÓ.
   *
   * Bản chưa chuẩn hoá không dùng được ở thời gian chạy: ngưỡng phân vị 90 của
   * BTC và của ENA khác nhau vài lần, mà lúc quét chỉ có 168 nến nên không tính
   * được phân vị. Chia cho sd168 làm đại lượng thành không thứ nguyên, một
   * ngưỡng dùng chung cho mọi mã.
   */
  xaChuanHoa: number;
}

const tb = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function lechChuan(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = tb(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Biên độ (high−low)/close của một cửa sổ. */
function bienDo(c: NenToiThieu[], tu: number, den: number): number {
  const w = c.slice(tu, den + 1);
  const hi = Math.max(...w.map((x) => x.h));
  const lo = Math.min(...w.map((x) => x.l));
  return (hi - lo) / c[den].c;
}

/** Đặc trưng tại cây `i`. CHỈ dùng nến tới `i`. null khi chưa đủ cửa sổ. */
export function dacTrungTai(c: NenToiThieu[], i: number): DacTrung | null {
  if (i < NEN_TANG) return null;

  const ls = (tu: number, den: number) => {
    const r: number[] = [];
    for (let k = tu; k <= den; k++) r.push(Math.log(c[k].c / c[k - 1].c));
    return r;
  };
  const sdNgan = lechChuan(ls(i - NGAN + 1, i));
  const sdNen = lechChuan(ls(i - NEN_TANG + 1, i));

  // Biên độ 24h của tuần vừa rồi, lấy từng cửa sổ 24h không chồng lấn.
  const bdTuan: number[] = [];
  for (let k = i - NEN_TANG + NGAN; k <= i; k += NGAN) bdTuan.push(bienDo(c, k - NGAN + 1, k));

  const volNgan = c.slice(i - NGAN + 1, i + 1).reduce((a, x) => a + x.v, 0);
  const volTuan: number[] = [];
  for (let k = i - NEN_TANG + NGAN; k <= i; k += NGAN) {
    volTuan.push(c.slice(k - NGAN + 1, k + 1).reduce((a, x) => a + x.v, 0));
  }
  const sma = tb(c.slice(i - NEN_TANG + 1, i + 1).map((x) => x.c));

  return {
    nenVol: sdNen > 0 ? sdNgan / sdNen : NaN,
    nenBienDo: bdTuan.length && tb(bdTuan) > 0 ? bienDo(c, i - NGAN + 1, i) / tb(bdTuan) : NaN,
    nenVol24: volTuan.length && tb(volTuan) > 0 ? volNgan / tb(volTuan) : NaN,
    xaTrungBinh: sma > 0 ? Math.abs(c[i].c / sma - 1) : NaN,
    xaChuanHoa: sma > 0 && sdNen > 0 ? Math.abs(c[i].c / sma - 1) / sdNen : NaN,
  };
}

/**
 * ĐỘ DỊCH CHUYỂN LỚN NHẤT phía trước, tính theo % giá tại `i`.
 *
 * Lấy MAX của hai phía chứ không lấy lợi suất cuối kỳ: một cú đâm xuống 8% rồi
 * quay về đúng chỗ cũ là một sự kiện có thật đối với người đang cầm lệnh, dù
 * lợi suất cuối kỳ bằng 0.
 */
export function bienDongToi(c: NenToiThieu[], i: number, gio: number): number | null {
  if (i + gio >= c.length) return null;
  const w = c.slice(i + 1, i + gio + 1);
  const hi = Math.max(...w.map((x) => x.h));
  const lo = Math.min(...w.map((x) => x.l));
  return Math.max(hi - c[i].c, c[i].c - lo) / c[i].c;
}

// ---------------------------------------------------------------------------
// BẢNG HIỆU CHUẨN + ĐÁNH GIÁ LÚC CHẠY
// ---------------------------------------------------------------------------

export interface HieuChuanMa {
  /** Ngưỡng `xaTrungBinh`, lấy phân vị 90 của NỬA ĐẦU mẫu 5 năm của chính mã đó. */
  nguong: number;
  /** Tỷ lệ nền ở nửa sau — mốc để so. */
  nenNgoaiMau: number;
  /** P(sự kiện) khi luật bắn, đo trên NỬA SAU (ngoài mẫu chọn ngưỡng). */
  pNgoaiMau: number;
  gapNen: number;
  nNgoaiMau: number;
}

export interface BangCanhBao {
  taoLuc: number;
  gio: number;
  nguongSuKien: number;
  moTaSuKien: string;
  ma: Record<string, HieuChuanMa>;
}

export type MucCanhBao = 'khong' | 'cao' | 'chua-hieu-chuan';

export interface CanhBaoSom {
  muc: MucCanhBao;
  /** |c/SMA168 − 1| hiện tại. */
  xa: number | null;
  nguong: number | null;
  /** Câu nói thẳng, kèm số đo — trang chỉ in ra. */
  cau: string;
  /** Số đo ngoài mẫu của luật này, null khi mã chưa hiệu chuẩn. */
  do: HieuChuanMa | null;
}

/**
 * CẢNH BÁO SỚM cho một mã.
 *
 * ĐÂY LÀ CẢNH BÁO ĐỘ LỚN, KHÔNG PHẢI HƯỚNG. Nó nói "sắp có cú lớn", không nói
 * cú đó đi lên hay xuống — và năm năm dữ liệu nói rằng hướng thì không đoán
 * được (xem /phan-tich).
 *
 * Mã chưa hiệu chuẩn thì KHÔNG cảnh báo. Ngưỡng của BTC (7.8%) và ENA (18.2%)
 * chênh nhau hơn hai lần; mượn ngưỡng của mã khác là bịa.
 */
export function danhGiaCanhBao(
  c: NenToiThieu[], symbol: string, bang: BangCanhBao,
): CanhBaoSom {
  const hc = bang.ma[symbol] ?? null;
  const closed = c.length - 1;
  const dt = closed >= NEN_TANG ? dacTrungTai(c, closed) : null;
  const xa = dt && Number.isFinite(dt.xaTrungBinh) ? dt.xaTrungBinh : null;

  if (!hc) {
    return {
      muc: 'chua-hieu-chuan', xa, nguong: null, do: null,
      cau: `Chưa hiệu chuẩn ngưỡng cho ${symbol} — không cảnh báo. `
        + 'Ngưỡng chênh nhau hơn hai lần giữa các mã, mượn ngưỡng mã khác là bịa.',
    };
  }
  if (xa == null) {
    return {
      muc: 'chua-hieu-chuan', xa: null, nguong: hc.nguong, do: hc,
      cau: `Chưa đủ ${NEN_TANG} nến 1H để tính khoảng cách tới trung bình.`,
    };
  }
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  if (xa > hc.nguong) {
    return {
      muc: 'cao', xa, nguong: hc.nguong, do: hc,
      cau: `Giá cách trung bình 168 giờ ${p1(xa)}, trên ngưỡng ${p1(hc.nguong)} của ${symbol}. `
        + `Ngoài mẫu, khi luật này bắn thì ${p1(hc.pNgoaiMau)} số lần có cú dịch chuyển lớn trong `
        + `${bang.gio} giờ tới — gấp ${hc.gapNen.toFixed(1)} lần mức nền ${p1(hc.nenNgoaiMau)} `
        + `(n=${hc.nNgoaiMau}). ĐỘ LỚN, không phải hướng.`,
    };
  }
  return {
    muc: 'khong', xa, nguong: hc.nguong, do: hc,
    cau: `Giá cách trung bình 168 giờ ${p1(xa)}, dưới ngưỡng ${p1(hc.nguong)} — không có cảnh báo. `
      + `Mức nền vẫn là ${p1(hc.nenNgoaiMau)} khả năng có cú lớn trong ${bang.gio} giờ tới.`,
  };
}
