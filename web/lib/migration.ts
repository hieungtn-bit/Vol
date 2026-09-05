import { computeVolumeProfile } from './volumeProfile';
import type { VPOptions } from './volumeProfile';
import type { Candle, VolumeProfile } from './types';

// ============================================================
// PHÁT HIỆN VALUE ĐÃ DỜI CHỖ
//
// Vấn đề: profile dựng trên một cửa sổ trượt cố định. Khi thị trường có một cú
// dời value thật (một sự kiện, một cây nến khổng lồ, một lần rời hẳn vùng cũ),
// cửa sổ đó còn ôm cả phân phối CŨ lẫn phân phối MỚI. Kết quả là một VA rộng
// vô nghĩa, POC nằm ở chỗ không ai giao dịch nữa, và mọi mức giá suy ra từ đó
// đều sai theo.
//
// Ví dụ thật (ENAUSDT, 05/09/2026): VA 1h ra 0.1495–0.1670 — rộng 11% giá —
// vì nó trộn phân phối trước và sau cú sập 04/09. Engine in ra entry
// 0.14000–0.15000 trong khi giá đang 0.1635, tức entry cách giá 9%, SL cách
// 10%. Đó không phải kèo, đó là rác.
//
// Cách phát hiện: cắt thử cửa sổ ở nhiều điểm. Tại mỗi điểm, dựng profile cho
// phần TRƯỚC và phần SAU rồi đo hai value area chồng lấn nhau bao nhiêu. Value
// dời chỗ thật thì hai vùng gần như không chồng nhau.
//
// Không nhìn trộm tương lai: hàm chỉ đọc đúng mảng nến được truyền vào, tức
// đúng những gì đã đóng tới thời điểm đang xét.
// ============================================================

/** Hai VA chồng nhau dưới mức này thì coi là value đã dời hẳn. */
export const OVERLAP_MAX = 0.2;

/**
 * Vùng giữa hai value phải MỎNG tới mức nào mới coi là value đã dời chỗ.
 *
 * Đo bằng mật độ chứ không bằng lượng: phần volume rơi vào vùng giữa, chia cho
 * phần volume mà bề rộng của nó ĐÁNG LẼ phải nắm nếu volume trải đều. 1.0 nghĩa
 * là vùng giữa dày đúng mức trung bình; 0 nghĩa là trống trơn.
 *
 * Đây là điều kiện phân biệt DỜI CHỖ với TRÔI ĐỀU, và nó quan trọng hơn phép đo
 * chồng lấn. Cắt đôi một xu hướng trôi đều thì hai nửa lúc nào cũng "không chồng
 * nhau" — nhưng khoảng giữa chúng dày đúng mức trung bình (đo được ≈ 0.98), vì
 * giá đã ĐI BỘ qua từng bước. Value dời chỗ thật để lại vùng giữa gần như trống
 * (đo được ≈ 0.03): giá NHẢY qua. Vùng trống đó chính là LVN — và nó mới là bằng
 * chứng, chứ không phải việc hai vùng rời nhau.
 */
export const GAP_THINNESS_MAX = 0.25;

/** Phần sau phải còn ít nhất bấy nhiêu nến thì profile mới mới đáng tin. */
export const MIN_KEEP = 24;

export interface Migration {
  /** Chỉ số nến bắt đầu vùng value đang dùng. 0 = không cắt gì. */
  from: number;
  /** Độ chồng lấn giữa VA cũ và VA mới, 0..1. null khi không phát hiện dời. */
  overlap: number | null;
  /** Câu giải thích để in cho người đọc. null khi không cắt. */
  note: string | null;
}

export const NO_MIGRATION: Migration = { from: 0, overlap: null, note: null };

/** Phần chồng lấn của hai đoạn, chia cho đoạn HẸP hơn. 0 = rời hẳn nhau. */
export function overlapRatio(
  a: { low: number; high: number },
  b: { low: number; high: number },
): number {
  const wa = a.high - a.low;
  const wb = b.high - b.low;
  if (!(wa > 0) || !(wb > 0)) return 1;      // không đo được thì coi như chồng nhau
  const inter = Math.min(a.high, b.high) - Math.max(a.low, b.low);
  if (inter <= 0) return 0;
  return inter / Math.min(wa, wb);
}

/** Đoạn nằm GIỮA hai vùng. null khi chúng chồng nhau hoặc dính nhau. */
export function gapBetween(
  a: { low: number; high: number },
  b: { low: number; high: number },
): { low: number; high: number } | null {
  const low = Math.min(a.high, b.high);
  const high = Math.max(a.low, b.low);
  return high > low ? { low, high } : null;
}

/**
 * Vùng giữa mỏng cỡ nào: phần volume nó nắm, chia cho phần nó ĐÁNG LẼ nắm nếu
 * volume trải đều theo giá. 1 = dày trung bình, 0 = trống trơn.
 */
export function gapThinness(vp: VolumeProfile, gap: { low: number; high: number }): number {
  const span = vp.bins[vp.bins.length - 1].high - vp.bins[0].low;
  const widthShare = span > 0 ? (gap.high - gap.low) / span : 0;
  if (!(widthShare > 0)) return 1;            // không đo được thì coi như dày
  return volumeShareIn(vp, gap.low, gap.high) / widthShare;
}

/** Phần volume của cả cửa sổ rơi vào một đoạn giá, 0..1. */
export function volumeShareIn(vp: VolumeProfile, low: number, high: number): number {
  if (!(vp.totalVol > 0)) return 1;
  let v = 0;
  for (const b of vp.bins) {
    // tính phần bin thật sự nằm trong đoạn, không tính cả bin theo tâm
    const inter = Math.min(b.high, high) - Math.max(b.low, low);
    if (inter <= 0) continue;
    const w = b.high - b.low;
    v += b.vol * (w > 0 ? Math.min(1, inter / w) : 1);
  }
  return v / vp.totalVol;
}

/**
 * Tìm điểm value dời chỗ GẦN NHẤT trong cửa sổ.
 *
 * Quét ngược từ hiện tại về quá khứ và lấy điểm cắt đầu tiên thoả điều kiện —
 * tức vùng value mới nhất. Trôi giá bình thường không kích hoạt được, vì hai
 * nửa vẫn chồng nhau nhiều; chỉ cú dời thật mới làm chúng rời hẳn.
 */
export function findValueMigration(
  candles: Candle[],
  binSize?: number,
  minKeep = MIN_KEEP,
): Migration {
  const closed = candles.filter((c) => c.closed);
  if (closed.length < minKeep * 2) return NO_MIGRATION;

  const opts = binSize != null ? { binSize } : {};
  const full = computeVolumeProfile(closed, opts);
  if (!full) return NO_MIGRATION;
  // Quét thưa: cửa sổ 168 nến thì thử khoảng 20 điểm cắt. Đủ để bắt cú dời mà
  // không phải dựng profile hàng trăm lần cho mỗi tín hiệu.
  const step = Math.max(1, Math.floor(closed.length / 24));

  for (let cut = closed.length - minKeep; cut >= minKeep; cut -= step) {
    const before = computeVolumeProfile(closed.slice(0, cut), opts);
    const after = computeVolumeProfile(closed.slice(cut), opts);
    if (!before || !after) continue;

    const ov = overlapRatio(before.va70, after.va70);
    if (ov >= OVERLAP_MAX) continue;

    // Hai vùng rời nhau chưa đủ. Vùng GIỮA phải mỏng — đó mới là dấu hiệu giá
    // nhảy qua chứ không đi bộ qua.
    const gap = gapBetween(before.va70, after.va70);
    if (!gap) continue;
    const thin = gapThinness(full, gap);
    if (thin >= GAP_THINNESS_MAX) continue;

    {
      // Chỉ số trong mảng GỐC, không phải trong mảng đã lọc nến đóng.
      const from = candles.indexOf(closed[cut]);
      return {
        from: from >= 0 ? from : cut,
        overlap: ov,
        note:
          `Value đã dời chỗ: ${closed.length - cut} nến gần nhất giao dịch ở vùng ` +
          `khác hẳn ${cut} nến trước đó (chồng lấn ${(ov * 100).toFixed(0)}%, ` +
          `vùng giữa ${(gap.low).toFixed(4)}–${(gap.high).toFixed(4)} chỉ dày ` +
          `${(thin * 100).toFixed(0)}% mức trung bình). ` +
          'Profile chỉ dựng trên vùng mới — vùng cũ giờ là vách, không phải value.',
      };
    }
  }
  return NO_MIGRATION;
}

/**
 * Profile dựng trên vùng value HIỆN TẠI. Trả về cả điểm cắt để phía gọi in ra
 * được lý do, thay vì lặng lẽ đổi kết quả sau lưng người đọc.
 */
export function profileOfCurrentValue(
  candles: Candle[],
  opts: VPOptions = {},
  enabled = true,
): { vp: VolumeProfile | null; migration: Migration } {
  const migration = enabled ? findValueMigration(candles, opts.binSize) : NO_MIGRATION;
  const use = migration.from > 0 ? candles.slice(migration.from) : candles;
  return { vp: computeVolumeProfile(use, opts), migration };
}


// ============================================================
// CỬA SỔ PROFILE TỰ CO
//
// Cắt điểm value dời chỗ chỉ xử lý được cú NHẢY. Nó không xử lý được cú ĐI BỘ:
// một tài sản trôi đều từ 0.065 lên 0.17 trong 90 ngày không có vùng mỏng nào ở
// giữa — giá đã giao dịch qua từng mức — nên không có điểm nào để cắt. Nhưng
// profile 90 ngày của nó ra VA rộng 52% giá với POC ở 0.0775 trong khi giá đang
// 0.1628. Đó không phải tham chiếu, đó là rác, và mọi mức giá suy ra từ nó đều
// vô nghĩa (đo được: entry cách giá 7.9%).
//
// Cách xử lý: value area phải rộng ở mức HỢP LÝ SO VỚI BIẾN ĐỘNG của chính khung
// đó. Rộng quá thì thu cửa sổ lại cho tới khi vừa. Vẫn không nhìn trộm tương lai
// vì chỉ bỏ bớt nến CŨ.
// ============================================================

/** VA rộng quá bao nhiêu lần ATR thì coi là không dùng được làm tham chiếu. */
export const MAX_VA_ATR = 10;

/** Các mức thu cửa sổ, theo phần của cửa sổ gốc. */
const SHRINK = [1, 0.7, 0.5, 0.35, 0.25];

export interface FittedProfile {
  vp: VolumeProfile | null;
  migration: Migration;
  /** Số nến thực sự dùng để dựng profile. */
  bars: number;
  /** Lý do thu cửa sổ, null khi dùng nguyên cửa sổ. */
  fitNote: string | null;
}

/**
 * Profile của vùng value đang dùng: cắt chỗ value dời (nếu có), rồi thu cửa sổ
 * lại nếu VA rộng quá so với biến động.
 */
export function fitProfileWindow(
  candles: Candle[],
  atrValue: number,
  opts: VPOptions = {},
  o: { migration?: boolean; maxVAoverATR?: number | null } = {},
): FittedProfile {
  const migration = o.migration !== false ? findValueMigration(candles, opts.binSize) : NO_MIGRATION;
  const base = migration.from > 0 ? candles.slice(migration.from) : candles;

  const cap = o.maxVAoverATR ?? null;
  const full = computeVolumeProfile(base, opts);
  if (cap == null || !full || !(atrValue > 0)) {
    return { vp: full, migration, bars: base.length, fitNote: null };
  }

  const limit = cap * atrValue;
  let best = full;
  let bars = base.length;
  for (const f of SHRINK) {
    const n = Math.max(MIN_KEEP, Math.round(base.length * f));
    if (n > base.length) continue;
    const vp = computeVolumeProfile(base.slice(base.length - n), opts);
    if (!vp) continue;
    best = vp;
    bars = n;
    if (vp.va70.high - vp.va70.low <= limit) break;
  }

  const w = best.va70.high - best.va70.low;
  const fitNote = bars < base.length
    ? `Cửa sổ profile thu từ ${base.length} xuống ${bars} nến: value area của cả cửa sổ ` +
      `rộng hơn ${cap}× ATR, tức nó ôm cả những vùng giá không còn liên quan. ` +
      `Sau khi thu, VA rộng ${(w / atrValue).toFixed(1)}× ATR.`
    : null;

  return { vp: best, migration, bars, fitNote };
}
