import { computeVolumeProfile } from './volumeProfile';
import type { Candle, VolumeProfile } from './types';

// ============================================================
// THƯỚC ĐO VOLUME PROFILE
//
// Lỗi cũ: `defaultBinSize()` chọn bước theo bậc giá rồi lại cho ATR GHI ĐÈ lên
// nó (`byAtr = niceStep(atr * 0.1)`, chỉ nới ra chứ không bao giờ thu vào). Trên
// một ngày ENA biên độ rộng, ATR đẩy bước từ 0.0005 lên 0.005 — thô gấp mười —
// và profile ngày ra POC 0.0775 với vùng giá trị 0.065–0.150 trong khi giá đang
// 0.163. Sai thước thì mọi mức giá suy ra từ nó đều sai theo.
//
// Thước mới có hai tầng:
//   1. Bước khởi điểm theo BẬC GIÁ, không cho ATR đụng vào.
//   2. Ràng buộc kiểm chứng được: số bin nằm trong vùng 70% phải từ 4 đến 25.
//      Ngoài khoảng thì đổi bước và dựng lại. Đây mới là thứ quyết định, và nó
//      tự lo luôn trường hợp BTC ngày (vùng rộng 7500 USD thì bước phải là hàng
//      trăm, không phải 10).
// ============================================================

/** Năm lớp thời gian. Không lớp nào được gộp với lớp nào. */
export type Layer = '10d' | '48h' | '24h' | 'after_event' | 'session_4h';

export const LAYER_VI: Record<Layer, string> = {
  '10d': '10 ngày',
  '48h': '48 giờ',
  '24h': '24 giờ',
  after_event: 'sau-event',
  session_4h: 'phiên 4 giờ',
};

/** Lớp dài — chỉ để biết vách cũ, KHÔNG được dùng đặt lệnh. */
export const COARSE_LAYERS: Layer[] = ['10d', '48h'];

/** Lớp được phép làm mép lệnh. */
export const TRADING_LAYERS: Layer[] = ['24h', 'after_event', 'session_4h'];

export const isCoarse = (l: Layer) => COARSE_LAYERS.includes(l);

/** Số bin trong vùng 70% phải nằm trong khoảng này, nếu không thì thước sai. */
export const MIN_VA_BINS = 4;
export const MAX_VA_BINS = 25;

/** Thang bước 1 / 2 / 5 — giữ số tròn để người đọc còn nhận ra mức giá. */
const LADDER = [1, 2, 5];

export function stepUp(step: number): number {
  const exp = Math.floor(Math.log10(step) + 1e-9);
  const base = Math.pow(10, exp);
  const m = Math.round(step / base);
  const i = LADDER.indexOf(m);
  if (i < 0 || i === LADDER.length - 1) return base * 10;
  return base * LADDER[i + 1];
}

export function stepDown(step: number): number {
  const exp = Math.floor(Math.log10(step) + 1e-9);
  const base = Math.pow(10, exp);
  const m = Math.round(step / base);
  const i = LADDER.indexOf(m);
  if (i <= 0) return (base / 10) * LADDER[LADDER.length - 1];
  return base * LADDER[i - 1];
}

/**
 * Bước khởi điểm theo bậc giá. Hai cột: lớp dài dùng bước thô, lớp ngắn dùng
 * bước mịn. ATR KHÔNG được tham gia ở đây — đó đúng là chỗ bản cũ hỏng.
 */
export function bandStep(price: number, layer: Layer): number {
  const coarse = isCoarse(layer);
  const p = Math.abs(price);
  if (p < 1) return coarse ? 0.001 : 0.0005;
  if (p < 20) return coarse ? 0.01 : 0.005;
  if (p < 200) return coarse ? 0.1 : 0.05;
  if (p < 2000) return coarse ? 1 : 0.5;
  return coarse ? 10 : 5;
}

export interface FittedProfile {
  vp: VolumeProfile;
  layer: Layer;
  /** Bước cuối cùng dùng để dựng. */
  step: number;
  /** Bước khởi điểm theo bậc giá, trước khi ràng buộc 4–25 bin chỉnh lại. */
  bandStep: number;
  /** Số bin nằm trong vùng 70%. Phải trong [4, 25]. */
  vaBins: number;
  /** Số lần phải đổi bước. 0 = bậc giá đã đúng ngay. */
  adjustments: number;
  note: string | null;
}

const vaBinsOf = (vp: VolumeProfile) =>
  Math.max(1, Math.round((vp.va70.high - vp.va70.low) / vp.binSize));

/**
 * Dựng profile của một lớp, tự chỉnh bước cho tới khi vùng 70% chứa 4–25 bin.
 *
 * Vòng lặp có trần, và luôn trả về profile TỐT NHẤT tìm được kể cả khi không đạt
 * — kèm ghi chú, để phía trên biết mà trừ điểm chứ không im lặng dùng số sai.
 */
export function fitProfile(candles: Candle[], layer: Layer, price?: number): FittedProfile | null {
  const closed = candles.filter((c) => c.closed);
  if (closed.length === 0) return null;
  const ref = price ?? closed[closed.length - 1].c;

  const start = bandStep(ref, layer);
  let step = start;
  let best: VolumeProfile | null = null;
  let adjustments = 0;

  for (let i = 0; i < 10; i++) {
    // Sàn bin toàn dải hạ xuống 6: ràng buộc thật của thước này là 4–25 bin
    // TRONG VÙNG 70%, và sàn 24 bin toàn dải sẽ ép bước mịn lại tới mức không
    // bao giờ thoả được ràng buộc đó (đúng ca BTC ngày).
    const vp = computeVolumeProfile(closed, { binSize: step, mode: 'close', minBins: 6 });
    if (!vp) return null;
    best = vp;
    const bins = vaBinsOf(vp);
    if (bins > MAX_VA_BINS) { step = stepUp(step); adjustments++; continue; }
    if (bins < MIN_VA_BINS) { step = stepDown(step); adjustments++; continue; }
    break;
  }
  if (!best) return null;

  const vaBins = vaBinsOf(best);
  const ok = vaBins >= MIN_VA_BINS && vaBins <= MAX_VA_BINS;
  return {
    vp: best,
    layer,
    step: best.binSize,
    bandStep: start,
    vaBins,
    adjustments,
    note: ok
      ? null
      : `Thước lớp ${LAYER_VI[layer]} chưa đạt: vùng 70% chứa ${vaBins} bin (cần ${MIN_VA_BINS}–${MAX_VA_BINS}). `
        + 'Mép của lớp này không đáng tin để đặt lệnh.',
  };
}

/**
 * Điểm kiểm soát là một DẢI, không phải một tick.
 *
 * Bản cũ in POC ra năm số lẻ như thể đọc được từ footprint. Không có footprint
 * thì con số đó là bịa. Dải = giao của các nến khối lượng lớn nhất đã đóng,
 * đúng cách một người đọc chart ước điểm kiểm soát bằng mắt.
 */
export function pocBand(
  candles: Candle[],
  vp: VolumeProfile,
  topN = 3,
): [number, number] {
  const closed = candles.filter((c) => c.closed);
  if (closed.length === 0) return [vp.poc, vp.poc + vp.binSize];

  const top = [...closed].sort((a, b) => b.v - a.v).slice(0, Math.max(2, topN));
  // Giao của các dải giá: nếu chúng không giao nhau thì lấy hợp của những cây
  // nặng nhất — vẫn là một dải thật, không phải một con số bịa.
  let lo = Math.max(...top.map((c) => c.l));
  let hi = Math.min(...top.map((c) => c.h));
  if (!(hi > lo)) {
    lo = Math.min(...top.map((c) => c.l));
    hi = Math.max(...top.map((c) => c.h));
  }

  // Điểm kiểm soát PHẢI nằm trong vùng giá trị và không được rộng hơn nó.
  // Không kẹp thì một cây event biên độ lớn kéo dải ra ngoài cả VA, và khi đó
  // "giá đứng giữa điểm kiểm soát" bắn nhầm ở khắp nơi — đo được trên ENA:
  // dải 0.157–0.170 trong khi VA chỉ 0.163–0.1655.
  const vaLo = vp.va70.low;
  const vaHi = vp.va70.high;
  const maxW = Math.max((vaHi - vaLo) * 0.5, vp.binSize * 2);

  lo = Math.max(lo, vaLo);
  hi = Math.min(hi, vaHi);
  if (!(hi > lo)) { lo = vp.poc; hi = vp.poc + vp.binSize; }

  if (hi - lo > maxW) {
    const mid = Math.min(Math.max(vp.poc, vaLo), vaHi);
    lo = Math.max(vaLo, mid - maxW / 2);
    hi = Math.min(vaHi, lo + maxW);
  }
  if (hi - lo < vp.binSize) hi = Math.min(vaHi, lo + vp.binSize);
  return [lo, hi];
}

/** Làm tròn một mức giá về đúng thước của lớp — không in số lẻ hơn bước. */
export function toStep(x: number, step: number): number {
  const d = Math.max(0, Math.ceil(-Math.log10(step) + 1e-9));
  return Number((Math.round(x / step) * step).toFixed(d));
}
