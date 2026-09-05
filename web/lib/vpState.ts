import type { LayerProfile } from './layers';
import type { Candle, TF } from './types';

// ============================================================
// BA TRẠNG THÁI — mỗi khung chọn ĐÚNG MỘT
//
// Lỗi cũ: `classifyStage()` trả về năm nhãn (edge-fail / edge-hold / breakdown /
// breakout / mid-range) qua một chuỗi if xếp chồng, và các câu chữ mô tả được
// sinh ra ở NHỮNG CHỖ KHÁC trong `direct.ts` và `decide.ts` dựa trên những phép
// so sánh riêng của chúng. Vì thế cùng một khung có thể vừa in "đã rời hẳn trên
// value 59500–67000" (do một nhánh) vừa in "nằm giữa value" (do nhánh khác).
//
// Cách sửa: một hàm duy nhất trả về một giá trị duy nhất, và MỌI câu chữ phải
// sinh ra từ chính giá trị đó. Kiểu union ba nhãn khiến trạng thái thứ tư không
// thể tồn tại, và `evidence` giải thích vì sao — cùng một nguồn, nên chữ không
// thể lệch số.
// ============================================================

export type VPState = 'trong_vung' | 'chap_nhan_ngoai' | 'vung_dich';

export const STATE_VI: Record<VPState, string> = {
  trong_vung: 'còn trong vùng',
  chap_nhan_ngoai: 'chấp nhận ngoài vùng',
  vung_dich: 'vùng giá trị dịch',
};

export interface StateRead {
  state: VPState;
  /** Phía nào — chỉ có nghĩa khi đã chấp nhận ngoài vùng hoặc vùng dịch. */
  side: 'tren' | 'duoi' | null;
  /** Câu giải thích, sinh ra TỪ CHÍNH trạng thái ở trên. */
  text: string;
  /** Giá cách điểm kiểm soát bao nhiêu lần bề rộng cụm. */
  distance: number;
  /** Đã có nến của khung này đóng và GIỮ ngoài cụm chưa. */
  heldOutside: boolean;
  /** Mép đang sống theo hướng giá đang đứng. */
  edge: { vah: number; val: number };
  /** Điểm kiểm soát ỨNG VỚI mép ở trên. Luôn nằm trong [val, vah]. */
  poc: [number, number];
}

/**
 * Giá đã ĐÓNG và GIỮ ngoài cụm chưa.
 *
 * "Giữ" nghĩa là nến gần nhất đã đóng ngoài mép, và nến đóng trước nó cũng
 * không quay lại trong cụm. Một cây đóng ngoài rồi cây sau chui về là quét, và
 * quét thì không phải chấp nhận. Cây CHƯA ĐÓNG không bao giờ được tính.
 */
export function heldOutside(
  closed: Candle[],
  vah: number,
  val: number,
): 'tren' | 'duoi' | null {
  const n = closed.length;
  if (n < 2) return null;
  const a = closed[n - 1];
  const b = closed[n - 2];
  if (a.c > vah && b.c > vah) return 'tren';
  if (a.c < val && b.c < val) return 'duoi';
  return null;
}

/**
 * Vùng giá trị đã DỊCH chưa: 2–3 cây khối lượng lớn đóng ở dải khác và lớn hơn
 * cụm cũ. Đo bằng chính các cây nặng nhất của khung, không bằng cảm giác.
 */
function valueShifted(
  closed: Candle[],
  vah: number,
  val: number,
  topN = 3,
): 'tren' | 'duoi' | null {
  if (closed.length < topN) return null;
  const recent = closed.slice(-Math.max(topN * 2, 6));
  const top = [...recent].sort((a, b) => b.v - a.v).slice(0, topN);
  const above = top.filter((c) => c.c > vah).length;
  const below = top.filter((c) => c.c < val).length;
  if (above >= 2) return 'tren';
  if (below >= 2) return 'duoi';
  return null;
}

const fmt = (x: number, step: number) => {
  const d = Math.max(0, Math.ceil(-Math.log10(step) + 1e-9));
  return x.toFixed(d);
};

/**
 * Đọc trạng thái của MỘT khung so với MỘT lớp.
 *
 * `closed` phải là nến đã đóng CỦA CHÍNH KHUNG ĐÓ — không phải nến 15m. Chấp
 * nhận hay từ chối là chuyện của nến khung đang xét.
 */
export function readState(
  layer: LayerProfile,
  closed: Candle[],
  tf: TF,
): StateRead {
  const { vp } = layer;
  // Cửa sổ có cú dịch thì VA của cả cửa sổ là VA TRỘN — nó ôm cả cụm cũ lẫn cụm
  // mới nên không mô tả đúng chỗ nào. Mốc để đọc trạng thái phải là cụm mà giá
  // VỪA RỜI, tức cụm cũ. Đây là chỗ bản trước kết luận "BTC đang ở giữa vùng
  // 59500–67000" trong khi giá 79700.
  const ref = layer.split ? layer.split.oldVA : vp.va70;
  const vah = ref.high;
  const val = ref.low;
  // Điểm kiểm soát phải lấy từ CÙNG một cụm với mép. Có split thì là cụm cũ.
  const [pocLo, pocHi] = layer.split ? layer.split.oldPoc : layer.poc;
  const pocMid = (pocLo + pocHi) / 2;
  const width = Math.max(vah - val, vp.binSize);
  const last = closed.length ? closed[closed.length - 1].c : pocMid;
  const distance = Math.abs(last - pocMid) / width;

  const held = heldOutside(closed, vah, val);
  // "Vùng dịch" đòi cụm MỚI phải LỚN HƠN cụm cũ, đúng như đề bài. Cụm mới nhỏ
  // hơn thì giá mới chỉ chấp nhận ra ngoài, chưa dựng được value mới.
  const biggerNew = layer.split ? layer.split.newVol > layer.split.oldVol : true;
  const shifted = biggerNew ? valueShifted(closed, vah, val) : null;
  const P = (x: number) => fmt(x, layer.step);
  const edge = { vah, val };
  const poc: [number, number] = [pocLo, pocHi];

  // Thứ tự xét là thứ tự MẠNH DẦN. Vùng dịch là kết luận nặng nhất, phải xét
  // trước; nếu không thì một cụm mới đã hình thành vẫn bị gọi là "chấp nhận
  // ngoài vùng cũ" mãi mãi.
  if (shifted && held && shifted === held) {
    return {
      state: 'vung_dich', side: shifted, distance, heldOutside: true, edge, poc,
      text: `Vùng giá trị đã dịch ${shifted === 'tren' ? 'lên' : 'xuống'}: các cây khối lượng lớn `
        + `của khung ${tf} đang đóng ${shifted === 'tren' ? 'trên' : 'dưới'} cụm cũ `
        + `${P(val)}–${P(vah)}. Cụm cũ giờ là vách.`,
    };
  }

  if (held) {
    return {
      state: 'chap_nhan_ngoai', side: held, distance, heldOutside: true, edge, poc,
      text: `Chấp nhận ngoài vùng, phía ${held === 'tren' ? 'trên' : 'dưới'}: nến ${tf} đã đóng và giữ `
        + `${held === 'tren' ? 'trên' : 'dưới'} cụm ${P(val)}–${P(vah)}. `
        + `Điểm kiểm soát cũ ${P(pocLo)}–${P(pocHi)} giờ là vách.`,
    };
  }

  return {
    state: 'trong_vung', side: null, distance, heldOutside: false, edge, poc,
    text: `Còn trong vùng ${P(val)}–${P(vah)}: giá ${P(last)} cách điểm kiểm soát `
      + `${P(pocLo)}–${P(pocHi)} khoảng ${distance.toFixed(2)}× bề rộng cụm, `
      + 'và chưa có nến nào của khung này đóng giữ ngoài cụm.',
  };
}

/**
 * Từ chối mép: chạm VAH/VAL rồi nến ĐÓNG trở lại trong vùng.
 * Chỉ có nghĩa khi trạng thái là "còn trong vùng".
 */
export function edgeRejection(
  layer: LayerProfile,
  closed: Candle[],
): { side: 'tren' | 'duoi'; level: number } | null {
  if (closed.length < 1) return null;
  const a = closed[closed.length - 1];
  const { vp } = layer;
  if (a.h >= vp.va70.high && a.c < vp.va70.high) return { side: 'tren', level: vp.va70.high };
  if (a.l <= vp.va70.low && a.c > vp.va70.low) return { side: 'duoi', level: vp.va70.low };
  return null;
}

/** Giá đang đứng GIỮA điểm kiểm soát — chỗ bị cấm vào lệnh. */
export function insidePoc(layer: LayerProfile, price: number): boolean {
  const [lo, hi] = layer.split ? layer.split.oldPoc : layer.poc;
  return price >= lo && price <= hi;
}
