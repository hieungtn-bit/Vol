import { DEFAULT_LEVELS, type LevelConfig } from './decide';
import { W, type Weights } from './direct';

// ============================================================
// CÁC PHIÊN BẢN THUẬT TOÁN, đặt cạnh nhau để so được.
//
// Không fork engine. Hai bản fork sẽ trôi khỏi nhau ở những chỗ không liên quan
// tới thứ đang muốn so, và khi đó phép so đo cả những khác biệt mình không định
// đo. Ở đây chỉ có MỘT code path, khác nhau bằng cấu hình.
//
// v1 phải cho ra kết quả GIỐNG HỆT bản đang chạy — có test khoá điều đó.
// ============================================================

export interface EngineVersion {
  id: string;
  name: string;
  weights: Weights;
  levels: LevelConfig;
  /** Vì sao khác v1, và dựa trên số đo nào. */
  rationale: string[];
}

export const V1: EngineVersion = {
  id: 'v1',
  name: 'bản đang chạy',
  weights: W,
  levels: DEFAULT_LEVELS,
  rationale: ['Nguyên trạng production. Mốc so sánh, không phải ứng viên.'],
};

/**
 * v2 — thu về phần có bằng chứng, và sửa một lỗi số học trong bộ dựng mức giá.
 *
 * HAI THAY ĐỔI, mỗi cái gắn với một số đo cụ thể:
 *
 * 1. TRỌNG SỐ THEO BẰNG CHỨNG. Đo edge từng vế trên 5487 lệnh (6 mã × 15m/1h/4h,
 *    đã sửa hai lỗi mô phỏng, gỡ thứ tự bằng nến 1m, có phái sinh lịch sử thật):
 *
 *      Cấu trúc HH/HL/LH/LL    n=5080   +0.16   có edge
 *      Taker Buy/Sell          n=3232   +0.08   có edge
 *      Open Interest           n=1252   +0.05   nhiễu
 *      Price Action            n=5095   +0.04   nhiễu
 *      Vị trí trong Value Area n=5166   −0.00   nhiễu
 *      Funding (ai trả ai)     n=133    −0.12   ĐI NGƯỢC
 *
 *    Bỏ hẳn funding (vế duy nhất chỉ sai hướng), giữ OI và PA ở mức nhỏ vì +0.05
 *    và +0.04 tuy dưới ngưỡng nhiễu nhưng đều DƯƠNG và đo trên mẫu lớn — bỏ sạch
 *    là quả quyết hơn mức bằng chứng cho phép. Dồn phần lớn về hai vế có edge.
 *
 *    Value Area giữ trọng số nhỏ chứ không bỏ: chỉ có VẾ CHẤM ĐIỂM của nó là
 *    nhiễu, còn volume profile vẫn là thứ dựng toàn bộ entry/SL/TP.
 *
 * 2. BẬC MỤC TIÊU PHẢI VƯỢT CHI PHÍ. Đây là số học, không phải tham số: bộ dựng
 *    cũ đặt bậc = max(ATR×0.5, binSize×3) và không có số hạng chi phí, nên trên
 *    khung nhỏ lúc lặng sóng nó sinh ra kế hoạch có TP1 nằm trong phí — 2.2% số
 *    tín hiệu, đo trên 16515 tín hiệu. Bản cũ chỉ TỪ CHỐI những kèo đó ở cửa;
 *    bản này dựng cho đúng ngay từ đầu, bằng cách bỏ qua tham chiếu quá gần và
 *    lấy tham chiếu THẬT kế tiếp của profile.
 *
 *    Hệ số 2: mục tiêu phải cách ít nhất hai vòng phí. Chọn 2 vì nó là mức thấp
 *    nhất còn có nghĩa (một vòng phí = hoà vốn trước trượt giá), không phải vì nó
 *    đo ra đẹp nhất.
 *
 * KHÔNG đổi: cửa chất lượng, ngưỡng hạng, cách dựng entry/SL, quy tắc mô phỏng.
 * Đổi nhiều thứ cùng lúc thì có tốt lên cũng không biết nhờ cái nào.
 */
export const V2: EngineVersion = {
  id: 'v2',
  name: 'thu về phần có bằng chứng',
  weights: {
    structure: 34,        // 25 → 34, vế có edge mạnh nhất (+0.16)
    takerFlow: 30,        // 20 → 30, vế có edge thứ hai (+0.08…+0.11)
    priceAction: 16,      // 18 → 16, dương nhưng nhiễu
    valueLocation: 14,    // 20 → 14, vế chấm điểm nhiễu (profile vẫn dựng mức giá)
    openInterest: 9,      // 12 → 9,  dương nhưng nhiễu
    funding: 0,           // 8 → 0,   vế DUY NHẤT đo ra đi ngược
  },
  levels: { costFloorMult: 2 },
  rationale: [
    'Bỏ funding: vế duy nhất có edge âm (−0.12 trên n=133).',
    'Dồn trọng số về cấu trúc (+0.16) và taker (+0.08).',
    'Giữ OI và PA ở mức nhỏ: dương nhưng dưới ngưỡng nhiễu, bỏ sạch là quá quả quyết.',
    'Bậc mục tiêu ≥ 2× chi phí vòng vào-ra — số học, không phải tham số.',
  ],
};

/** Đối chứng ngược: giữ đúng phần đo ra nhiễu, bỏ hai vế có bằng chứng. */
export const V_CONTROL: EngineVersion = {
  id: 'đối chứng',
  name: 'giữ phần nhiễu, bỏ phần có bằng chứng',
  weights: { structure: 0, valueLocation: 36, takerFlow: 0, priceAction: 32, openInterest: 21, funding: 14 },
  levels: DEFAULT_LEVELS,
  rationale: [
    'Nếu "cấu trúc + taker mới là thứ mang tín hiệu" đúng, bản này phải TỆ HẲN.',
    'Không có đối chứng thì mọi cải thiện đều có thể chỉ là đổi tham số gặp may.',
  ],
};

/** Tổng trọng số phải giữ nguyên giữa các bản. */
export function weightTotal(w: Weights): number {
  return w.structure + w.valueLocation + w.takerFlow + w.priceAction + w.openInterest + w.funding;
}
