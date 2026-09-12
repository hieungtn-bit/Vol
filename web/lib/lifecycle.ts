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
import { NGUONG_VOL_CHET as VOL_CHET } from './hourflow';
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

  // ---- Hourflow 1H (lib/hourflow.ts). Tất cả tính từ nến 1H ĐÃ ĐÓNG. ----
  /** TB volume 1H của phiên, đã loại cây max bất thường. */
  hf1hTb: number | null;
  /** vol cây 1H đóng gần nhất / TB phiên. */
  hf1hLastVsTb: number | null;
  /** Delta taker SPOT của cây 1H đóng gần nhất (field 9 kline spot). */
  hf1hLastDelta: number | null;
  hf1hLastPos: 'tren' | 'giua' | 'duoi' | null;
  /** Cây 1H ĐANG MỞ đã ≥ 3× TB phiên. */
  hf1hEventOpen: boolean;
  /** Dải vol 1H lớn nhất, dùng làm POC dự phòng cho H6 khi cum1h trống. */
  poc1h: { low: number; high: number; bars: number[] } | null;
  /** Chỗ đóng của cây 4H ĐÃ ĐÓNG gần nhất — H14 đọc số này. */
  k4hLastPos: 'tren' | 'giua' | 'duoi' | null;
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
  /** Được phép in thiên hướng hay không. */
  noiDuocHuong: boolean;
  /** Hướng thẻ được phép khoá. null = chỉ theo dõi. */
  khoaHuong: 'LONG' | 'SHORT' | null;
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
type KieuHet = 'sl-last' | 'sl-cay' | 'toi-chot' | 'het-han' | 'trigger-hong';

/**
 * Khoá lưu KIỂU và giá lúc hết, KHÔNG lưu câu chữ. Lần quét sau dựng lại câu từ
 * `last` hiện tại — nếu cache chuỗi thì thẻ 22:42 vẫn in "last 0.154" trong khi
 * giá đã là 0.15362.
 */
const khoaHet = new Map<string, { ts: number; kieu: KieuHet; giaLucHet: number; slHitTs: number | null }>();

function lyDoHet(kieu: KieuHet, i: LifecycleInput, giaLucHet: number, tsHet: number): string {
  const gio = new Date(tsHet).toISOString().slice(11, 16);
  const mo = {
    'sl-last': `last ${giaLucHet} đã xuyên SL ${i.sl}`,
    'sl-cay': `cây ${i.tf} đang mở đã xuyên SL ${i.sl}`,
    'toi-chot': `đã tới chốt — last ${giaLucHet} cách TP1 ${i.tp1} dưới ${tpHitTol(giaLucHet, i.atr1h).toFixed(6)}`,
    'het-han': `hết hạn sau ${i.barsSinceIssued} nến ${i.tf} mà giá không vào vùng`,
    'trigger-hong': `trigger hỏng — nến ${i.tf} đã đóng ${i.lastClosedK?.c} không qua ${i.triggerLevel}`,
  }[kieu];
  return mo;
}

/**
 * Câu lý do cho thẻ ĐÃ KHOÁ. Dựng lại mỗi lần quét từ `last` hiện tại:
 *   còn đang vi phạm  → nói thẳng bằng giá LÚC NÀY;
 *   đã hết vi phạm    → nói mốc đã hết, kèm giá lúc này, và rằng id đã khoá.
 * Cache nguyên câu thì thẻ 22:42 vẫn in "last 0.154" trong khi giá đã 0.15362.
 */
function lyDoKhoa(kieu: KieuHet, i: LifecycleInput, giaLucHet: number, tsHet: number): string {
  const conViPham = i.side === 'SHORT' ? i.last >= i.sl : i.last <= i.sl;
  if ((kieu === 'sl-last' || kieu === 'sl-cay') && conViPham) return lyDoHet('sl-last', i, i.last, tsHet);
  const gio = new Date(tsHet).toISOString().slice(11, 16);
  return `${lyDoHet(kieu, i, giaLucHet, tsHet)} (HẾT lúc ${gio}); last hiện tại ${i.last}, id đã khoá`;
}

export function resetKhoaHet() { khoaHet.clear(); }
export function daKhoaHet(id: string) { return khoaHet.get(id) ?? null; }

const trong = (x: number, lo: number, hi: number) => x >= Math.min(lo, hi) && x <= Math.max(lo, hi);

/**
 * Sai số để nói "last đã tới TP1". Bằng số vì "≈" không dịch thẳng thành mã:
 *   tpHit = |last − tp1| ≤ max(0.25×ATR_1H, 0.003×last)
 * Lấy max để thẻ trên mã biến động thấp không bị sai số ATR nhỏ làm kẹt mãi.
 * Test phải GỌI hàm này, không được gõ lại con số.
 */
export function tpHitTol(last: number, atr1h: number | null): number {
  return Math.max(atr1h != null && atr1h > 0 ? 0.25 * atr1h : 0, 0.003 * last);
}

export function daToiTP(last: number, tp1: number, atr1h: number | null): boolean {
  return Math.abs(last - tp1) <= tpHitTol(last, atr1h);
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
  // LUẬT H3 (SHORT; LONG đối xứng):
  //   last > entry_high và last < sl        → CHO_GIA, kéo lại từ trên, chưa vào.
  //   last < entry_low và chưa chạm tp1     → CHO_GIA, đã rời + chờ kéo lại mép cụm cũ.
  //   last ≤ tp1 trong sai số tpHitTol      → HET "đã tới chốt", KHÔNG phải CHO_GIA.
  //   H11 vẫn thắng H3: sát đáy 24h thì CAM, không được CHO_GIA để short.
  const daToiChot = isShort
    ? i.last <= i.tp1 + tpHitTol(i.last, i.atr1h)
    : i.last >= i.tp1 - tpHitTol(i.last, i.atr1h);
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

  // H6 — SL không được nằm GIỮA cụm vol 2–3 nến 1H lớn nhất đã đóng. Thiếu cụm
  // dựng sẵn thì rơi về dải vol 1H (pocTuNenVol) — không có cụm KHÔNG có nghĩa
  // là không có túi stop.
  const cum = i.cum1h ?? i.poc1h;
  if (cum && i.sl > cum.low && i.sl < cum.high) failed.push('H6');

  // H7 — TP1 ngoài VA và quãng TP1–entry quá ngắn.
  if (i.tp1OutsideVa && risk > 0 && Math.abs(i.tp1 - (isShort ? entryLo : entryHi)) < 0.6 * risk) {
    failed.push('H7');
  }

  // H8 — cấm fade cây expansion khung K khi cây đó CHƯA ĐÓNG. Hai cách nhận
  // diện, nối bằng HOẶC (cách cũ giữ nguyên nghĩa, cách mới chỉ thêm vào):
  //   (cũ) vol ≥ 3× cây K liền trước VÀ xuyên cả hai cực của nó;
  //   (mới) vol cây đang mở ≥ 3× TB 1H phiên.
  //
  // LƯU Ý về cách (mới) trên khung > 1H: nó so một cây nhiều giờ với trung bình
  // MỘT giờ, nên cây 4H bình thường đã ~4× TB và điều kiện này bắt rất dễ. Chỗ
  // đó không đổi trạng thái — H1 vốn đã cấm SONG suốt lúc cây còn mở — nhưng
  // phải biết rằng trên 4H/1D nhãn H8 nói "cây đang chạy to", không nói "bất
  // thường so với chính khung đó".
  const expansionCu = i.openK != null && i.lastClosedK != null
    && i.lastClosedK.v > 0 && i.openK.v >= 3 * i.lastClosedK.v
    && i.openK.h >= i.lastClosedK.h && i.openK.l <= i.lastClosedK.l;
  const expansionTb = i.openK != null && i.hf1hTb != null && i.hf1hTb > 0
    && i.openK.v >= 3 * i.hf1hTb;
  const expansion = expansionCu || expansionTb;
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

  // H14 — thẻ 15m không được đi NGƯỢC cây 4H ĐÃ ĐÓNG gần nhất. Cây 4H đang mở
  // không tính: bấc cây đang chạy chưa phải chấp nhận.
  if (i.tf === '15m' && i.k4hLastPos
      && (isShort ? i.k4hLastPos === 'tren' : i.k4hLastPos === 'duoi')) {
    failed.push('H14');
  }

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

  // S5 — vol 1H chết. Khung 15m/1h vào lệnh lúc cây 1H vừa đóng dưới nửa TB
  // phiên là vào lúc không ai giao dịch: chặn SONG như S2, không khoá hướng.
  // 4H không dùng S5 — ở đó H1/CHO_GIA đã giữ vai trò đó.
  const volChet = (i.tf === '15m' || i.tf === '1h')
    && i.hf1hLastVsTb != null && i.hf1hLastVsTb < VOL_CHET;
  if (volChet) soft.push('S5');

  // =========================================================================
  // TRẠNG THÁI. Thứ tự: HET > CAM > CHO_NEN > CHO_GIA > SONG.
  // =========================================================================
  let state: CardState;
  let reason: string;
  let slHitTs: number | null = null;

  const khoa = khoaHet.get(id);
  const hetHan = i.barsSinceIssued > EXPIRE[i.tf];
  const triggerHong = triggerFired === false;

  let kieuHet: KieuHet | null = null;
  if (khoa) {
    kieuHet = khoa.kieu;
  } else if (xuyenSl) {
    kieuHet = (isShort ? i.last >= i.sl : i.last <= i.sl) ? 'sl-last' : 'sl-cay';
  } else if (daToiChot) {
    kieuHet = 'toi-chot';
  } else if (hetHan) {
    kieuHet = 'het-han';
  } else if (triggerHong) {
    kieuHet = 'trigger-hong';
  }

  if (kieuHet) {
    state = 'HET';
    const giaLucHet = khoa ? khoa.giaLucHet : i.last;
    const tsHet = khoa ? khoa.ts : i.ts;
    slHitTs = khoa ? khoa.slHitTs : (kieuHet === 'sl-last' || kieuHet === 'sl-cay' ? i.ts : null);
    reason = khoa ? lyDoKhoa(kieuHet, i, giaLucHet, tsHet) : lyDoHet(kieuHet, i, i.last, i.ts);
    if (!khoa) khoaHet.set(id, { ts: i.ts, kieu: kieuHet, giaLucHet: i.last, slHitTs });
  } else if (failed.filter((g) => g !== 'H1' && g !== 'H4').length > 0) {
    state = 'CAM';
    reason = `trượt cổng cứng ${failed.filter((g) => g !== 'H1' && g !== 'H4').join(', ')}`;
  } else if (!trongVung) {
    // GIÁ đứng trước NẾN. Khi giá còn chưa vào vùng thì thứ đang chặn là giá,
    // không phải cây đang chạy — và trong dữ liệu sống thì LÚC NÀO cũng có một
    // cây đang chạy, nên xếp CHO_NEN lên trước sẽ làm CHO_GIA không bao giờ
    // xuất hiện. H1 vẫn nằm nguyên trong failedGates và vẫn cấm SONG.
    state = 'CHO_GIA';
    reason = `last ${i.last} chưa vào vùng ${entryLo}–${entryHi}`
      + (nenConMo ? ` (nến ${i.tf} cũng chưa đóng)` : '');
  } else if (nenConMo) {
    state = 'CHO_NEN';
    reason = `giá đã vào vùng nhưng nến ${i.tf} chưa đóng`;
  } else if (failed.includes('H4')) {
    state = 'CHO_GIA';
    reason = `trigger chưa kích hoạt: ${i.triggerText}`;
  } else if (volChet) {
    state = 'CAM';
    reason = `vol 1H đóng ${i.hf1hLastVsTb!.toFixed(2)}× TB phiên — vol chết, không khoá hướng`;
  } else if (soft.includes('S2')) {
    // S2 — nến khung thẻ ĐÓNG ngược hướng thẻ (SHORT mà đóng nửa trên / đúng cao
    // cây). Không được khoá hướng và không được SONG: hạ CAM, chờ một nến đóng
    // thuận hướng. Cây 1H 06:00 ngày 12/09 đóng đúng cao cây mà hệ vẫn giữ SHORT.
    state = 'CAM';
    reason = `nến ${i.tf} đã đóng NGƯỢC hướng thẻ (đóng ${i.lastClosedK?.c} ở nửa `
      + `${isShort ? 'trên' : 'dưới'} cây) — không khoá hướng ${i.side}`;
  } else {
    state = 'SONG';
    reason = 'trong vùng vào, qua H1–H13';
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

  const noiDuocHuong = NOI_DUOC_HUONG.includes(state)
    && !soft.includes('S2') && !soft.includes('S5');
  return {
    id, state, banner: BANNER[state], reason,
    failedGates: failed, softFlags: soft, grade, slHitTs,
    noiDuocHuong,
    // Hướng mà thẻ được phép KHOÁ. null = chỉ theo dõi, không được nói hướng.
    khoaHuong: noiDuocHuong ? i.side : null,
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
