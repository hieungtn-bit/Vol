/**
 * HOURFLOW 1H — đọc nhịp từ nến 1H ĐÃ ĐÓNG.
 *
 * Thuần: không fetch, không đọc đồng hồ ngoài tham số truyền vào. Mọi hàm ở đây
 * chỉ nhận nến và trả số, để cả quét live lẫn test đều đi qua đúng một đường.
 *
 * NGUỒN DELTA — đọc kỹ trước khi gắn nhãn:
 * `takerBuyBase` trong repo này lấy từ field 9 của kline SPOT
 * (data-api.binance.vision /api/v3/klines). Repo KHÔNG gọi kline USD-M ở đâu cả
 * (fapi chỉ dùng cho premiumIndex / openInterest / fundingRate / OI hist /
 * takerlongshortRatio). Nên delta tính ở đây là DELTA TAKER SPOT, và phải gọi
 * đúng tên đó. Ngày nào thêm kline USD-M thì nhãn phải đổi theo nguồn, không
 * đổi theo chỗ dùng. `takerlongshortRatio` là TỶ LỆ của chợ perp — số khác,
 * chợ khác, không được cộng chung vào đây.
 */

/** Nến tối thiểu mà hourflow cần. Trùng tập trường con của `Candle`. */
export interface HFBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Volume base. Cùng đơn vị với con số desk đọc trên chart. */
  v: number;
  takerBuyBase: number | null;
  closed: boolean;
}

/** Vol cây đóng / TB phiên từ mức này trở lên mới gọi là event. */
export const NGUONG_EVENT = 3.0;

/** Dưới mức này là vol chết — cổng mềm S5 dùng số này. */
export const NGUONG_VOL_CHET = 0.5;

const ICT_OFFSET_MIN = 7 * 60;

function trungVi(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface SessionTb {
  tb: number;
  median: number;
  eventThreshold: number;
  /** Số cây thật sự dùng để tính, sau khi loại cây max bất thường. */
  soCay: number;
  /** Cây bị loại vì quá lớn so với trung vị, null khi không loại cây nào. */
  loaiCay: number | null;
}

/**
 * TB volume phiên, tính trên NẾN 1H ĐÃ ĐÓNG từ 00:00 ICT. Dưới 8 cây thì phiên
 * còn quá non để làm mốc — lấy 12 cây đóng gần nhất thay vì để một hai cây đầu
 * phiên định nghĩa "bình thường".
 *
 * Loại đúng MỘT cây max khi nó lớn hơn 3× trung vị: một cây tin tức kéo TB lên
 * là mọi cây sau đó đều trông như vol chết.
 */
export function sessionTb(k1hClosed: HFBar[], nowIct = Date.now()): SessionTb {
  const closed = k1hClosed.filter((b) => b.closed);
  const shifted = nowIct + ICT_OFFSET_MIN * 60_000;
  const dauPhien = Math.floor(shifted / 86_400_000) * 86_400_000 - ICT_OFFSET_MIN * 60_000;

  let dung = closed.filter((b) => b.t >= dauPhien);
  if (dung.length < 8) dung = closed.slice(-12);
  if (!dung.length) return { tb: 0, median: 0, eventThreshold: NGUONG_EVENT, soCay: 0, loaiCay: null };

  const vols = dung.map((b) => b.v);
  const med = trungVi(vols);
  const max = Math.max(...vols);
  let con = vols;
  let loaiCay: number | null = null;
  if (med > 0 && max > 3 * med && vols.length > 1) {
    const i = vols.indexOf(max);
    con = vols.filter((_, j) => j !== i);
    loaiCay = max;
  }
  const tb = con.reduce((a, b) => a + b, 0) / con.length;
  return { tb, median: med, eventThreshold: NGUONG_EVENT, soCay: con.length, loaiCay };
}

export interface BarRead {
  /** vol cây / TB phiên. null khi chưa có TB. */
  vsTb: number | null;
  /** takerBuy − takerSell. null khi venue không công bố taker. */
  delta: number | null;
  /** delta / vol, −1..1. null khi không có delta. */
  imb: number | null;
  closePos: 'tren' | 'giua' | 'duoi' | null;
  event: boolean;
}

/**
 * Đọc một cây. CHỈ gọi trên cây ĐÃ ĐÓNG khi dùng để kết luận — cây đang chạy
 * không được vào TB, không được vào POC, không được tuyên bố event.
 */
export function readBar(bar: HFBar, tb: number | null): BarRead {
  const vsTb = tb != null && tb > 0 ? bar.v / tb : null;
  const delta = bar.takerBuyBase != null ? 2 * bar.takerBuyBase - bar.v : null;
  const range = bar.h - bar.l;
  const pos = range > 0 ? (bar.c - bar.l) / range : null;
  return {
    vsTb,
    delta,
    imb: delta != null && bar.v > 0 ? delta / bar.v : null,
    closePos: pos == null ? null : pos >= 0.66 ? 'tren' : pos <= 0.33 ? 'duoi' : 'giua',
    event: bar.closed && vsTb != null && vsTb >= NGUONG_EVENT,
  };
}

export interface Dai {
  low: number;
  high: number;
  /** Mốc thời gian các cây tạo ra dải này. */
  bars: number[];
}

const giao = (bs: HFBar[]): Dai | null => {
  const low = Math.max(...bs.map((b) => b.l));
  const high = Math.min(...bs.map((b) => b.h));
  return high > low ? { low, high, bars: bs.map((b) => b.t).sort((a, b) => a - b) } : null;
};

/**
 * POC ước 1H: dải chồng nhau của 2–3 cây volume lớn nhất ĐÃ ĐÓNG.
 *
 * Chồng rỗng nghĩa là hai cụm giá riêng biệt chứ không phải một vùng — khi đó
 * tách thành các cụm cây thật sự chồng nhau và lấy cụm có TỔNG VOL lớn hơn.
 * Trả null khi không dựng được: thà không có POC còn hơn có một dải bịa.
 */
/** Cây thứ ba chỉ được vào cụm khi vol của nó còn cùng hạng với cây thứ hai. */
const CUNG_HANG = 0.75;

export function pocTuNenVol(bars: HFBar[]): Dai | null {
  const closed = bars.filter((b) => b.closed && b.h > b.l);
  if (closed.length < 2) return null;
  const xep = [...closed].sort((a, b) => b.v - a.v);
  // "2–3 cây vol lớn nhất": hai cây đầu luôn tính, cây thứ ba chỉ tính khi nó
  // thật sự cùng hạng. Một cây nhỏ hơn hẳn mà vẫn cho vào sẽ kéo dải chồng hẹp
  // lại quanh vùng của riêng nó — cụm 20:00+21:00 (0.1505–0.1566) bị cây 19:00
  // bóp còn 0.1548–0.1560 là đúng lỗi đó.
  const top = xep.length >= 3 && xep[2].v >= CUNG_HANG * xep[1].v
    ? xep.slice(0, 3)
    : xep.slice(0, 2);

  const ca = giao(top);
  if (ca) return ca;

  // Gom thành các cụm cây chồng nhau, chọn cụm tổng vol lớn nhất.
  const cum: HFBar[][] = [];
  for (const b of top) {
    const vao = cum.find((g) => giao([...g, b]) != null);
    if (vao) vao.push(b); else cum.push([b]);
  }
  let best: Dai | null = null;
  let bestVol = -1;
  for (const g of cum) {
    const d = g.length === 1
      ? { low: g[0].l, high: g[0].h, bars: [g[0].t] }
      : giao(g);
    if (!d) continue;
    const vol = g.reduce((a, b) => a + b.v, 0);
    if (vol > bestVol) { bestVol = vol; best = d; }
  }
  return best;
}

/**
 * Mô tả nhịp bằng lời. CHỈ để đọc — không vế nào ở đây được dùng làm cổng, vì
 * chưa có phép đo nào chứng minh chúng phân loại được kết quả.
 */
export function noiNhip(bars: HFBar[], tb: number | null): string[] {
  const closed = bars.filter((b) => b.closed);
  if (!closed.length || tb == null || tb <= 0) return [];
  const out: string[] = [];
  const n = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}m` : x.toFixed(0));

  const cuoi = closed[closed.length - 1];
  const r = readBar(cuoi, tb);
  out.push(`Cây 1H vừa đóng: vol ${n(cuoi.v)} = ${r.vsTb!.toFixed(2)}× TB phiên (${n(tb)}).`);
  if (r.closePos) {
    out.push(`Đóng ở nửa ${r.closePos === 'tren' ? 'TRÊN' : r.closePos === 'duoi' ? 'DƯỚI' : 'GIỮA'} cây.`);
  }
  if (r.delta != null) {
    out.push(`Delta taker spot ${r.delta >= 0 ? '+' : ''}${n(r.delta)}`
      + (r.imb != null ? ` (${(r.imb * 100).toFixed(0)}% vol cây).` : '.'));
  }
  const ev = closed.slice(-12).filter((b) => readBar(b, tb).event);
  if (ev.length) {
    out.push(`${ev.length} cây event (≥ ${NGUONG_EVENT.toFixed(1)}× TB) trong 12 cây gần nhất.`);
  }
  const poc = pocTuNenVol(closed.slice(-48));
  if (poc) out.push(`Dải vol 1H lớn nhất: ${poc.low}–${poc.high} (${poc.bars.length} cây).`);
  return out.slice(0, 5);
}
