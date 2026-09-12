/**
 * VÒNG ĐỜI THẺ + CỔNG CỨNG/MỀM cho bản điện.
 *
 * Vì sao tách hẳn ra một file thuần: mọi bug ENA 11–12/09 đều là bug VÒNG ĐỜI,
 * không phải bug chấm điểm. Thẻ 4H in "ĐỦ ĐIỀU KIỆN" trong khi nến 4H còn mở,
 * last đã xuyên SL, và trigger chưa xảy ra — ba sự thật đó không nằm trong
 * điểm số, chúng nằm ở việc thẻ đang ở trạng thái nào. Tách ra để chấm điểm
 * KHÔNG BAO GIỜ cộng đủ để thắng cổng cứng.
 *
 * Hàm này thuần: vào là sự thật quan sát được, ra là trạng thái. Không fetch,
 * không đọc cache, không nhìn trạng thái lần quét trước (trừ khoá HET).
 */
import type { TF } from './types';

export type CardState = 'CHO_NEN' | 'CHO_GIA' | 'SONG' | 'HET' | 'CAM';
export type Grade = 'A' | 'B' | 'C';

export const BANNER: Record<CardState, string> = {
  CHO_NEN: 'CHƯA ĐÓNG NẾN — KHÔNG MỞ',
  CHO_GIA: 'CHỜ GIÁ VÀO — KHÔNG MỞ',
  SONG: 'ĐỦ ĐIỀU KIỆN',
  HET: 'TÍN HIỆU HẾT — KHÔNG MỞ',
  CAM: 'TRƯỢT ĐIỀU KIỆN — KHÔNG MỞ',
};

/** Trạng thái được phép nói "hướng vẫn X". Ba trạng thái kia thì cấm. */
export const NOI_DUOC_HUONG: CardState[] = ['SONG', 'CHO_GIA'];

export interface BarK {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  closed: boolean;
}

export interface LifecycleInput {
  symbol: string;
  tf: TF;
  side: 'LONG' | 'SHORT';
  entryLow: number;
  entryHigh: number;
  sl: number;
  tp1: number;
  tp2: number;
  triggerText: string;
  /** Mức giá mà nến khung K phải ĐÓNG qua thì trigger mới kích hoạt. */
  triggerLevel: number | null;

  /** Giá LIVE lúc quét. Không phải close của nến đóng gần nhất. */
  last: number;
  ts: number;

  /** Nến khung K đang hình thành. null khi không lấy được. */
  openK: BarK | null;
  /** Nến khung K đã đóng gần nhất. */
  lastClosedK: BarK | null;

  /** R kỳ vọng của thẻ. */
  rr: number | null;
  atr1h: number | null;
  low24h: number | null;
  high24h: number | null;
  /** low của cây 4H có volume lớn nhất trong cửa sổ gần đây. */
  low4hMaxVol: number | null;
  high4hMaxVol: number | null;

  /** Cụm vol 2–3 nến 1H lớn nhất ĐÃ ĐÓNG. bars = mốc thời gian nến tạo cụm. */
  cum1h: { low: number; high: number; bars: number[] } | null;
  /** Đã có nến 1H ĐÓNG từ chối mép cụm đã rời chưa (kéo lại rồi đóng qua mép). */
  rejected1h: boolean;

  /** Cảnh báo "TP1 ngoài VA" đang bật. */
  tp1OutsideVa: boolean;
  /** vol nến K đóng gần nhất / median khung. */
  volRatio: number | null;
  /** Số vế taker/spot/PA đang ngược hướng thẻ. */
  opposingLegs: number;
  /** TP xuyên đáy/đỉnh tuần-tháng mà dưới đó không có cụm vol đỡ. */
  tpBreaksUnbackedLevel: boolean;

  /** Số nến khung K đã trôi qua từ lúc thẻ ra đời. */
  barsSinceIssued: number;
}

export interface LifecycleVerdict {
  id: string;
  state: CardState;
  banner: string;
  reason: string;
  failedGates: string[];
  softFlags: string[];
  grade: Grade;
  slHitTs: number | null;
  /** Được phép in "hướng vẫn X" hay không. */
  noiDuocHuong: boolean;
}

/** Hết hạn sau bấy nhiêu nến khung K mà giá không vào vùng. */
const EXPIRE: Record<TF, number> = { '15m': 8, '1h': 6, '4h': 4, '1d': 3 };

export function cardId(i: Pick<LifecycleInput,
  'symbol' | 'tf' | 'side' | 'entryLow' | 'entryHigh' | 'sl' | 'triggerText'>): string {
  const k = [i.symbol, i.tf, i.side, i.entryLow, i.entryHigh, i.sl, i.triggerText].join('|');
  let h = 0;
  for (let n = 0; n < k.length; n++) h = (Math.imul(31, h) + k.charCodeAt(n)) | 0;
  return `${i.symbol}-${i.tf}-${i.side}-${(h >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Khoá HET. Đây là THỨ DUY NHẤT được mang qua giữa hai lần quét.
// Cấm mang SONG / QUA CỬA qua lần quét sau — mọi thẻ phải tính lại từ đầu.
// ---------------------------------------------------------------------------
const khoaHet = new Map<string, { ts: number; reason: string; slHitTs: number | null }>();

export function resetKhoaHet() { khoaHet.clear(); }
export function daKhoaHet(id: string) { return khoaHet.get(id) ?? null; }

const trong = (x: number, lo: number, hi: number) => x >= Math.min(lo, hi) && x <= Math.max(lo, hi);

/** Khoảng cách coi như "đã tới nơi": 0.25×ATR 1H, hoặc 0.3% giá khi thiếu ATR. */
function saiSoToiNoi(i: LifecycleInput): number {
  return i.atr1h != null && i.atr1h > 0 ? 0.25 * i.atr1h : 0.003 * i.last;
}

export function evaluate(i: LifecycleInput): LifecycleVerdict {
  const id = cardId(i);
  const isShort = i.side === 'SHORT';
  const failed: string[] = [];
  const soft: string[] = [];
  const entryLo = Math.min(i.entryLow, i.entryHigh);
  const entryHi = Math.max(i.entryLow, i.entryHigh);
  const entryMid = (entryLo + entryHi) / 2;
  const risk = Math.abs(entryMid - i.sl);

  // =========================================================================
  // CỔNG CỨNG
  // =========================================================================

  // H1 — nến khung của thẻ phải ĐÃ ĐÓNG. Thẻ 4H không SONG khi 4H đang mở.
  const nenConMo = i.openK != null && !i.openK.closed;
  if (nenConMo) failed.push('H1');

  // H2 — SHORT: last < sl. LONG: last > sl.
  const h2 = isShort ? i.last < i.sl : i.last > i.sl;
  if (!h2) failed.push('H2');

  // H10 — huỷ so với CẢ last VÀ high/low cây K đang mở.
  const xuyenSl = isShort
    ? i.last >= i.sl || (i.openK != null && i.openK.h >= i.sl)
    : i.last <= i.sl || (i.openK != null && i.openK.l <= i.sl);
  if (xuyenSl) failed.push('H10');

  // H3 — vùng vào còn tiếp cận được không, và đã tới chốt chưa.
  const trongVung = trong(i.last, entryLo, entryHi);
  const tol = saiSoToiNoi(i);
  const daToiChot = isShort ? i.last <= i.tp1 + tol : i.last >= i.tp1 - tol;
  // Vùng vào còn tiếp cận được từ HAI phía, và hai phía có điều kiện khác nhau:
  //   phía SL — giá chưa rơi vào vùng, chỉ còn tiếp cận được khi chưa xuyên SL;
  //   phía TP — giá đã rời vùng về phía chốt (SHORT: đã thủng xuống dưới entry).
  //             Đây chính là "đã rời + kéo lại mép cụm cũ" của desk: vẫn là chỗ
  //             xem lệnh, miễn là chưa tới TP1. Thẻ 4H 07:32 entry 0.142–0.143
  //             với last 0.1405 thuộc đúng nhóm này — CHỜ GIÁ, không phải trượt.
  const phiaSl = isShort ? i.last > entryHi : i.last < entryLo;
  const phiaTp = isShort ? i.last < entryLo : i.last > entryHi;
  const tiepCanDuoc = trongVung
    || (phiaSl && (isShort ? i.last < i.sl : i.last > i.sl))
    || (phiaTp && !daToiChot);
  if (!tiepCanDuoc && !daToiChot) failed.push('H3');

  // H4 — trigger phải còn sống so với NẾN ĐÃ ĐÓNG. Chưa đóng = chưa kích hoạt.
  let triggerFired: boolean | null = null;
  if (i.triggerLevel != null && i.lastClosedK != null) {
    triggerFired = isShort
      ? i.lastClosedK.c < i.triggerLevel
      : i.lastClosedK.c > i.triggerLevel;
  }
  if (triggerFired !== true) failed.push('H4');

  // H5 — R kỳ vọng.
  const rr = i.rr;
  if (rr == null || rr < 0.5) failed.push('H5');

  // H6 — SL không được nằm GIỮA cụm vol 2–3 nến 1H lớn nhất đã đóng.
  if (i.cum1h && i.sl > i.cum1h.low && i.sl < i.cum1h.high) failed.push('H6');

  // H7 — TP1 ngoài VA và quãng TP1–entry quá ngắn.
  if (i.tp1OutsideVa && risk > 0 && Math.abs(i.tp1 - (isShort ? entryLo : entryHi)) < 0.6 * risk) {
    failed.push('H7');
  }

  // H8 — cây K expansion (vol ≥ 3× cây trước VÀ xuyên hai cực) chưa đóng → cấm fade.
  const expansion = i.openK != null && i.lastClosedK != null
    && i.lastClosedK.v > 0 && i.openK.v >= 3 * i.lastClosedK.v
    && i.openK.h >= i.lastClosedK.h && i.openK.l <= i.lastClosedK.l;
  if (expansion && nenConMo) failed.push('H8');

  // H11 — cấm SHORT sát đáy 24h / đáy cây 4H vol lớn nhất. LONG đối xứng.
  if (i.atr1h != null && i.atr1h > 0) {
    if (isShort) {
      const d24 = i.low24h != null ? i.last - i.low24h : Infinity;
      const d4h = i.low4hMaxVol != null ? i.last - i.low4hMaxVol : Infinity;
      if (d24 < i.atr1h || d4h < i.atr1h) failed.push('H11');
    } else {
      const d24 = i.high24h != null ? i.high24h - i.last : Infinity;
      const d4h = i.high4hMaxVol != null ? i.high4hMaxVol - i.last : Infinity;
      if (d24 < i.atr1h || d4h < i.atr1h) failed.push('H11');
    }
  }

  // H12 — SHORT 15m/1H phải có nến 1H ĐÓNG từ chối mép cụm đã rời. Một cây đỏ không đủ.
  if (isShort && (i.tf === '15m' || i.tf === '1h') && !i.rejected1h) failed.push('H12');

  // H13 — ngày không được mở lệnh; và cấm TP xuyên mức không có cụm vol đỡ.
  if (i.tf === '1d' || i.tpBreaksUnbackedLevel) failed.push('H13');

  // =========================================================================
  // CỔNG MỀM — chỉ trừ hạng, không chặn
  // =========================================================================

  // S1 — cây 4H xuyên hai cực.
  if (expansion) soft.push('S1');

  // S2 — nến khung thẻ ĐÓNG ngược hướng thẻ.
  if (i.lastClosedK) {
    const b = i.lastClosedK;
    const span = b.h - b.l;
    const viTri = span > 0 ? (b.c - b.l) / span : 0.5;
    if (isShort ? viTri >= 0.5 : viTri <= 0.5) soft.push('S2');
  }

  // S3 — taker/spot/PA ngược ≥ 2 vế.
  if (i.opposingLegs >= 2) soft.push('S3');

  // S4 — volume mỏng.
  if (i.volRatio != null && i.volRatio < 0.6) soft.push('S4');

  // =========================================================================
  // TRẠNG THÁI. Thứ tự: HET > CAM > CHO_NEN > CHO_GIA > SONG.
  // =========================================================================
  let state: CardState;
  let reason: string;
  let slHitTs: number | null = null;

  const khoa = khoaHet.get(id);
  const hetHan = i.barsSinceIssued > EXPIRE[i.tf];
  const triggerHong = triggerFired === false;

  if (khoa) {
    state = 'HET';
    reason = khoa.reason;
    slHitTs = khoa.slHitTs;
  } else if (xuyenSl) {
    state = 'HET';
    slHitTs = i.ts;
    const lastXuyen = isShort ? i.last >= i.sl : i.last <= i.sl;
    reason = lastXuyen
      ? `last ${i.last} đã xuyên SL ${i.sl}`
      : `cây ${i.tf} đang mở đã xuyên SL ${i.sl}`;
  } else if (daToiChot) {
    state = 'HET';
    reason = `đã tới chốt — last ${i.last} chạm TP1 ${i.tp1}`;
  } else if (hetHan) {
    state = 'HET';
    reason = `hết hạn sau ${i.barsSinceIssued} nến ${i.tf} mà giá không vào vùng`;
  } else if (triggerHong) {
    state = 'HET';
    reason = `trigger hỏng — nến ${i.tf} đã đóng ${i.lastClosedK?.c} không qua ${i.triggerLevel}`;
  } else if (failed.filter((g) => g !== 'H1' && g !== 'H4').length > 0) {
    state = 'CAM';
    reason = `trượt cổng cứng ${failed.filter((g) => g !== 'H1' && g !== 'H4').join(', ')}`;
  } else if (nenConMo) {
    state = 'CHO_NEN';
    reason = `nến ${i.tf} chưa đóng`;
  } else if (failed.includes('H4')) {
    state = 'CHO_GIA';
    reason = `trigger chưa kích hoạt: ${i.triggerText}`;
  } else if (!trongVung) {
    state = 'CHO_GIA';
    reason = `last ${i.last} chưa vào vùng ${entryLo}–${entryHi}`;
  } else {
    state = 'SONG';
    reason = 'trong vùng vào, qua H1–H13';
  }

  if (state === 'HET' && !khoa) {
    khoaHet.set(id, { ts: i.ts, reason, slHitTs });
  }

  // Hạng A chỉ khi SONG + R ≥ 0.80 + last trong vùng + không S3/S4.
  let grade: Grade;
  if (state === 'SONG' && rr != null && rr >= 0.8 && trongVung
      && !soft.includes('S3') && !soft.includes('S4')) {
    grade = 'A';
  } else if (rr != null && rr >= 0.8 && !soft.includes('S1')) {
    grade = 'B';
  } else {
    grade = 'C';
  }

  return {
    id, state, banner: BANNER[state], reason,
    failedGates: failed, softFlags: soft, grade, slHitTs,
    noiDuocHuong: NOI_DUOC_HUONG.includes(state),
  };
}

/**
 * H9 — cùng symbol, cùng lần quét: nếu một khung CAM/HET cùng hướng thì khung
 * khác không được SONG hạng A. Phải chạy SAU khi cả 4 khung đã có verdict.
 */
export function apDungH9(verdicts: { side: 'LONG' | 'SHORT'; v: LifecycleVerdict }[]): void {
  for (const { side, v } of verdicts) {
    if (v.state !== 'SONG' || v.grade !== 'A') continue;
    const conBacBo = verdicts.some(
      (o) => o.v !== v && o.side === side && (o.v.state === 'CAM' || o.v.state === 'HET'),
    );
    if (conBacBo) {
      v.grade = 'B';
      v.failedGates = [...v.failedGates, 'H9'];
      v.reason += ' · H9: khung khác cùng hướng đang TRƯỢT/HẾT nên không hạng A';
    }
  }
}
