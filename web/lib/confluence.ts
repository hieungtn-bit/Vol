import { insidePoc, type StateRead, type VPState } from './vpState';
import type { LayerProfile } from './layers';
import { isCoarse } from './ruler';
import type { DeltaDivergence } from './deltaDiv';
import type { Candle, OIInfo, ScoreLine, TF } from './types';

// ============================================================
// ĐIỂM HỢP LƯU — bảng mới, thay hoàn toàn `scoreConfluence()` cũ
//
// GHI RÕ: các hệ số dưới đây do người đặt theo kinh nghiệm desk, KHÔNG phải do
// backtest hiệu chuẩn. Mọi con số PF/avgR đã đo trước đây đều đo trên thước cũ
// và bảng điểm cũ, nên chúng KHÔNG còn áp dụng cho bảng này. Muốn nói lại về
// hiệu quả thì phải chạy lại backtest trên thước mới — chưa chạy thì không
// tuyên bố gì.
// ============================================================

export const SCORE_FLOOR = 7;        // dưới mức này: đứng ngoài, CẤM in mức giá
export const HALF_SIZE_MAX = 8.5;    // 7–8.5 khổ nửa; ≥8.5 mới xét khổ đủ
export const GOLD_MARGIN = 4;        // lệch điểm tối thiểu để gọi là hạng vàng

export interface ConfluenceInput {
  tf: TF;
  /** Lớp dùng để đặt lệnh. */
  layer: LayerProfile;
  state: StateRead;
  /** Nến ĐÃ ĐÓNG của chính khung này. */
  closed: Candle[];
  last: number;
  /** Median volume 20 nến của khung. */
  volMedian20: number;
  /** Delta của khung này, cùng dấu với hướng đang xét thì cộng. */
  tfDelta: number | null;
  /** Spot và hợp đồng có cùng nghiêng không. */
  spotPerpAgree: boolean;
  /** Funding: điểm ±0.5 / ±1 theo bậc, dấu dương = ủng hộ mua. */
  fundingPoints: number;
  divergence: DeltaDivergence | null;
  oi: OIInfo;
  /** Độ rộng cắt tính theo % giá — chỉ để trừ điểm khi quá rộng. */
  slPct: number | null;
  /** Lớp đang dùng có bị trộn hai cụm không (chưa tách được). */
  mixedLayer: boolean;
  /**
   * Vừa TỪ CHỐI mép nào (chạm VAH/VAL rồi nến đóng trở lại trong vùng).
   *
   * Đặc tả mục E cho phép mở NGƯỢC CHIỀU MÉP sau nến đóng, và cú từ chối mép
   * theo định nghĩa xảy ra khi giá VẪN CÒN TRONG VÙNG. Không truyền thông tin
   * này vào thì luật "còn trong vùng → không mở lệnh mới" nuốt luôn cả đường
   * vào lệnh chính của thị trường cân bằng.
   */
  rejection: { side: 'tren' | 'duoi' } | null;
  /**
   * Dữ liệu bắt buộc có đủ để CHẤM ĐIỂM không.
   *
   * Thiếu dữ liệu ≠ thị trường không có cơ hội. Trộn hai thứ đó lại là cách một
   * hệ báo cáo "0 lệnh" trong khi thật ra nó chưa từng đánh giá được nến nào.
   */
  dataOk: boolean;
  /** Vế nào không chấm được vì thiếu dữ liệu. */
  missing: string[];
}

export interface ConfluenceOut {
  side: 'mua' | 'ban';
  score: number;
  lines: ScoreLine[];
}

const CLOSE_EDGE = 0.35;   // đóng trong 35% trên/dưới cây = xác nhận theo chiều

/**
 * Chấm điểm cho MỘT hướng. Gọi hai lần (mua và bán) rồi lấy bên cao hơn —
 * chênh lệch giữa hai bên chính là "lệch điểm" dùng cho hạng vàng.
 */
export function scoreSide(inp: ConfluenceInput, side: 'mua' | 'ban'): ConfluenceOut {
  const lines: ScoreLine[] = [];
  const { layer, state, last } = inp;
  const bull = side === 'mua';
  const bar = inp.closed[inp.closed.length - 1];

  /**
   * Vị trí của SETUP, không phải vị trí của cây nến xác nhận.
   *
   * Đây là chỗ bảng điểm cũ tự mâu thuẫn. Một cú TỪ CHỐI MÉP theo định nghĩa là
   * "chạm mép rồi ĐÓNG TRỞ LẠI TRONG VÙNG". Nhưng vế "+2 giá tại VAL/VAH" lại đo
   * giá ĐÓNG, và vế "−4 giá đứng giữa điểm kiểm soát" cũng đo giá đóng. Nên đúng
   * cái setup mà luật hành động cho phép thì vừa trượt +2 vừa ăn −4 — nó bị chấm
   * như thể là kiểu vào lệnh giữa vùng đang bị cấm.
   *
   * Cả hai vế đó nói về CHỖ ĐẶT LỆNH. Vậy phải đo trên chỗ đặt lệnh: mép vừa bị
   * chạm (fade) hoặc mép vừa bị phá (đi theo chiều rời).
   */
  const brokenSide = state.state !== 'trong_vung' ? state.side : inp.rejection?.side ?? null;
  const setupAt = brokenSide === 'tren' ? state.edge.vah
    : brokenSide === 'duoi' ? state.edge.val
    : last;

  // +2 — PA ở mép (từ chối hoặc giữ). Cú từ chối mép LÀ "PA ở mép", kể cả khi
  // nến xác nhận đã đóng trở lại trong vùng.
  if (inp.rejection != null || state.state !== 'trong_vung' || state.distance > 0.5) {
    const atEdge = state.state === 'chap_nhan_ngoai' || state.state === 'vung_dich'
      ? (bull ? state.side === 'tren' : state.side === 'duoi')
      : true;
    if (atEdge) lines.push({ label: 'PA ở mép (từ chối hoặc giữ)', points: 2 });
  }

  // +2 — giá tại VAL/VAH của lớp ĐƯỢC PHÉP đặt lệnh. Lớp 10 ngày không tính.
  if (!isCoarse(layer.layer)) {
    // Mép liên quan là mép của SETUP. Khi không có sự kiện mép nào thì mới xét
    // mép theo chiều lệnh như cũ.
    const edge = brokenSide === 'tren' ? state.edge.vah
      : brokenSide === 'duoi' ? state.edge.val
      : bull ? state.edge.val : state.edge.vah;
    const near = Math.abs(setupAt - edge) <= Math.max(layer.step * 2, Math.abs(edge) * 0.0025);
    if (near) lines.push({ label: `Setup tại ${edge === state.edge.vah ? 'VAH' : 'VAL'} lớp ${layer.layer}`, points: 2 });
  }

  // +1.5 — nến đóng xác nhận + volume ≥ median 20
  if (bar) {
    const rng = Math.max(bar.h - bar.l, 1e-12);
    const pos = (bar.c - bar.l) / rng;
    const confirmed = bull ? pos >= 1 - CLOSE_EDGE : pos <= CLOSE_EDGE;
    if (confirmed && inp.volMedian20 > 0 && bar.v >= inp.volMedian20) {
      lines.push({ label: 'Nến đóng xác nhận + vol ≥ median 20', points: 1.5 });
    }
  }

  // +1 — delta cùng chiều TRÊN ĐÚNG KHUNG
  if (inp.tfDelta != null && inp.tfDelta !== 0) {
    if ((bull && inp.tfDelta > 0) || (!bull && inp.tfDelta < 0)) {
      lines.push({ label: `Delta khung ${inp.tf} cùng chiều`, points: 1 });
    }
  }

  // +1 — spot và hợp đồng cùng nghiêng
  if (inp.spotPerpAgree) lines.push({ label: 'Spot và hợp đồng cùng nghiêng', points: 1 });

  // +0.5 — funding cùng hướng, mức nhẹ trở lên
  const fp = bull ? inp.fundingPoints : -inp.fundingPoints;
  if (fp > 0) lines.push({ label: 'Funding cùng hướng', points: 0.5 });
  else if (fp < 0) lines.push({ label: 'Funding ngược hướng', points: -0.5 });

  // −4 — CHỖ ĐẶT LỆNH nằm giữa điểm kiểm soát. Luật cứng số 2 cấm VÀO LỆNH giữa
  // vùng; nó không nói gì về chỗ cây nến xác nhận đóng.
  if (!isCoarse(layer.layer) && insidePoc(layer, setupAt)) {
    lines.push({ label: 'Chỗ đặt lệnh nằm giữa điểm kiểm soát — chỗ cấm vào', points: -4 });
  }

  // −2 — lớp đang dùng còn trộn hai cụm
  if (inp.mixedLayer) {
    lines.push({ label: 'Lớp đang dùng còn trộn hai cụm — mép không đáng tin', points: -2 });
  }

  // −1.5 — cắt phải rộng hơn 5% giá
  if (inp.slPct != null && inp.slPct > 5) {
    lines.push({ label: `Cắt phải rộng ${inp.slPct.toFixed(1)}% giá`, points: -1.5 });
  }

  // −2 — phân kỳ ngược hướng đang chạy
  const d = inp.divergence;
  if (d && d.status === 'dang_chay') {
    const bearishDiv = d.type === 'ban_thuong' || d.type === 'an_ban';
    if ((bull && bearishDiv) || (!bull && !bearishDiv)) {
      lines.push({ label: 'Phân kỳ ngược hướng đang chạy', points: -2 });
    }
  }

  // −1 — OI tăng trong range khi setup là breakout
  const breakout = state.state === 'chap_nhan_ngoai' || state.state === 'vung_dich';
  if (breakout && inp.oi.quality === 'REAL' && inp.oi.read === 'flat' && (inp.oi.chg1h ?? 0) > 0.5) {
    lines.push({ label: 'OI tăng trong range khi setup là breakout', points: -1 });
  }

  const score = lines.reduce((s, l) => s + l.points, 0);
  return { side, score, lines };
}

export type Bias = 'dung_ngoai' | 'mua' | 'ban';
export type Size = 'kho_nua' | 'kho_du';

export type DataStatus = 'DATA_INSUFFICIENT' | 'NO_SETUP' | 'VALID_SETUP';

export interface Verdict {
  bias: Bias;
  /** Ba trạng thái tách bạch: thiếu dữ liệu / đủ dữ liệu nhưng không đạt / đạt. */
  dataStatus: DataStatus;
  score: number;
  margin: number;
  size: Size | null;
  golden: boolean;
  lines: ScoreLine[];
  /** Vì sao đứng ngoài. Rỗng khi có lệnh. */
  reasons: string[];
}

/**
 * Quyết định cuối cùng của một khung.
 *
 * Sàn điểm là luật CỨNG: dưới 7 thì bias = đứng ngoài và phía trên KHÔNG được
 * phép in entry/SL/TP. Đây đúng là lỗi #5 của bản cũ — điểm 4.5 vẫn in ra một
 * bộ mức giá đầy đủ, và người đọc không có cách nào biết nó không đáng vào.
 */
export function verdict(
  inp: ConfluenceInput,
  perm: { fullSize: boolean; halfSize: boolean; blocked: string | null },
  /**
   * Hạ sàn điểm — CHỈ để chẩn đoán trong backtest, không bao giờ dùng khi chạy
   * thật. Mặc định là SCORE_FLOOR, và mọi đường chạy thật đều để mặc định.
   */
  floor = SCORE_FLOOR,
): Verdict {
  const mua = scoreSide(inp, 'mua');
  const ban = scoreSide(inp, 'ban');
  const win = mua.score >= ban.score ? mua : ban;
  const margin = Math.abs(mua.score - ban.score);
  const reasons: string[] = [];

  // Thiếu dữ liệu bắt buộc thì KHÔNG được kết luận gì về thị trường.
  if (!inp.dataOk) {
    return {
      bias: 'dung_ngoai', dataStatus: 'DATA_INSUFFICIENT', score: win.score, margin,
      size: null, golden: false, lines: win.lines,
      reasons: [`Thiếu dữ liệu bắt buộc (${inp.missing.join(', ')}) — không đánh giá được, không phải "không có cơ hội".`],
    };
  }

  // Còn trong vùng thì không mở lệnh mới — TRỪ cú từ chối mép, và chỉ theo đúng
  // chiều ngược với mép vừa bị từ chối.
  const fadeSide: 'mua' | 'ban' | null = inp.rejection
    ? (inp.rejection.side === 'tren' ? 'ban' : 'mua')
    : null;

  if (inp.state.state === 'trong_vung') {
    if (!fadeSide) {
      reasons.push(`Còn trong vùng — lệnh mới không mở. ${inp.state.text}`);
    } else if (win.side !== fadeSide) {
      reasons.push(
        `Còn trong vùng, vừa từ chối mép ${inp.rejection!.side === 'tren' ? 'trên' : 'dưới'} — `
        + `chỉ được mở ${fadeSide === 'ban' ? 'bán' : 'mua'}, nhưng điểm đang nghiêng phía kia.`,
      );
    }
  }

  if (win.score < floor) {
    reasons.push(`Điểm ${win.score.toFixed(1)} dưới sàn ${floor} — chưa đủ để vào tiền.`);
  }
  if (perm.blocked) reasons.push(perm.blocked);

  if (reasons.length > 0) {
    return {
      bias: 'dung_ngoai', dataStatus: 'NO_SETUP', score: win.score, margin,
      size: null, golden: false, lines: win.lines, reasons,
    };
  }

  const size: Size = win.score >= Math.max(HALF_SIZE_MAX, floor + 1.5) && perm.fullSize ? 'kho_du' : 'kho_nua';
  if (size === 'kho_nua' && !perm.halfSize) {
    return {
      bias: 'dung_ngoai', dataStatus: 'NO_SETUP', score: win.score, margin, size: null,
      golden: false, lines: win.lines,
      reasons: ['Chưa có nến 15 phút đóng đủ điều kiện cho khổ nửa.'],
    };
  }

  const golden = margin >= GOLD_MARGIN && win.lines.every((l) => l.points >= 0);
  return {
    bias: win.side, dataStatus: 'VALID_SETUP', score: win.score, margin, size,
    golden, lines: win.lines, reasons: [],
  };
}
