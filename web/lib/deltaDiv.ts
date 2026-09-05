import type { Candle, TF } from './types';

// ============================================================
// DELTA VÀ PHÂN KỲ — chỉ nến ĐÃ ĐÓNG, mỗi khung một chuỗi riêng
//
// Không có footprint. Delta của một nến = taker mua − taker bán, suy từ trường
// thứ 10 của kline (`takerBuyBase`):
//     delta = takerBuy − (volume − takerBuy) = 2·takerBuy − volume
// Đó là con số THẬT của sàn, không phải ước lượng theo hướng đóng cửa.
//
// CVD của 15m, 1h, 4h là ba chuỗi khác nhau. Cộng dồn chúng vào một chuỗi là
// trộn ba đơn vị đo, và mọi phân kỳ đọc ra từ đó đều vô nghĩa.
// ============================================================

/** Delta của một nến. null khi sàn không công bố taker cho nến đó. */
export function barDelta(c: Candle): number | null {
  if (c.takerBuyBase == null) return null;
  return 2 * c.takerBuyBase - c.v;
}

export interface HourFlowRow {
  t: number;
  o: number; h: number; l: number; c: number;
  vol: number;
  /** vol so với trung bình các cây 1 giờ đóng cùng phiên. */
  volVsMean: number;
  delta: number | null;
  takerPct: number | null;
  /** Một câu diễn biến, sinh từ chính ba số trên. */
  read: string;
}

const NEAR_EDGE = 0.3;   // đóng trong 30% trên/dưới của cây = "đóng gần cao/thấp"

/**
 * Hourflow: 8–12 cây 1 giờ ĐÃ ĐÓNG gần nhất.
 *
 * Mẫu diễn biến theo đúng effort-vs-result: vol lớn mà giá đi xa rồi đóng về
 * giữa là TỪ CHỐI, không phải "đang tích luỹ". Vol nhỏ thì không đọc gì cả —
 * im lặng là kết luận hợp lệ.
 */
export function hourFlow(c1h: Candle[], n = 12): HourFlowRow[] {
  const closed = c1h.filter((c) => c.closed).slice(-n);
  if (!closed.length) return [];
  const mean = closed.reduce((s, c) => s + c.v, 0) / closed.length;

  return closed.map((c) => {
    const d = barDelta(c);
    const rng = Math.max(c.h - c.l, 1e-12);
    const posInBar = (c.c - c.l) / rng;
    const volVsMean = mean > 0 ? c.v / mean : 1;
    const big = volVsMean >= 1.3;

    let read: string;
    if (!big) read = 'volume nhỏ — không đọc';
    else if (posInBar >= 1 - NEAR_EDGE && (d ?? 0) > 0) read = 'vol lớn + đóng gần cao + delta dương → chấp nhận lên';
    else if (posInBar <= NEAR_EDGE && (d ?? 0) < 0) read = 'vol lớn + đóng gần thấp + delta âm → chấp nhận xuống';
    else read = 'vol lớn nhưng đóng về giữa/ngược → từ chối (công sức ≠ kết quả)';

    return {
      t: c.t, o: c.o, h: c.h, l: c.l, c: c.c,
      vol: c.v, volVsMean, delta: d,
      takerPct: c.takerBuyBase != null && c.v > 0 ? (c.takerBuyBase / c.v) * 100 : null,
      read,
    };
  });
}

export type DivType = 'ban_thuong' | 'mua_thuong' | 'an_mua' | 'an_ban';
export type DivStatus = 'dang_chay' | 'da_fill' | 'het_hieu_luc';

export const DIV_VI: Record<DivType, string> = {
  ban_thuong: 'phân kỳ bán thường (giá đỉnh cao hơn, delta thấp hơn)',
  mua_thuong: 'phân kỳ mua thường (giá đáy thấp hơn, delta cao hơn)',
  an_mua: 'phân kỳ ẩn mua (giá đỉnh cao hơn, delta cao hơn)',
  an_ban: 'phân kỳ ẩn bán (giá đáy thấp hơn, delta thấp hơn)',
};

export interface DeltaDivergence {
  type: DivType;
  status: DivStatus;
  /** Hai swing tạo ra phân kỳ, cũ → mới. */
  swings: { t: number; price: number; cvd: number }[];
  text: string;
}

/** CVD cộng dồn của ĐÚNG một khung. Không bao giờ trộn khung. */
export function cvdSeries(closed: Candle[]): number[] {
  let acc = 0;
  return closed.map((c) => { acc += barDelta(c) ?? 0; return acc; });
}

/** Đỉnh/đáy fractal 2 bên — đủ chặt để gọi là "swing rõ". */
function swings(closed: Candle[], k = 2): { hi: number[]; lo: number[] } {
  const hi: number[] = [];
  const lo: number[] = [];
  for (let i = k; i < closed.length - k; i++) {
    let isHi = true; let isLo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (closed[j].h >= closed[i].h) isHi = false;
      if (closed[j].l <= closed[i].l) isLo = false;
    }
    if (isHi) hi.push(i);
    if (isLo) lo.push(i);
  }
  return { hi, lo };
}

/**
 * Phân kỳ chỉ được công nhận khi có HAI swing rõ. Một swing thì không có gì để
 * so, và "cảm thấy delta yếu dần" không phải phân kỳ.
 */
export function findDivergence(c: Candle[], tf: TF): DeltaDivergence | null {
  const closed = c.filter((x) => x.closed);
  if (closed.length < 12) return null;
  if (closed.every((x) => x.takerBuyBase == null)) return null;

  const cvd = cvdSeries(closed);
  const { hi, lo } = swings(closed);
  const last = closed[closed.length - 1].c;

  const mk = (type: DivType, a: number, b: number, priceA: number, priceB: number): DeltaDivergence => {
    // Trạng thái: đã fill khi giá quay lại quá mức của swing đầu; hết hiệu lực
    // khi giá vượt hẳn swing sau theo chiều mà phân kỳ nói là yếu.
    const bearish = type === 'ban_thuong' || type === 'an_ban';
    let status: DivStatus = 'dang_chay';
    if (bearish && last > priceB) status = 'het_hieu_luc';
    else if (bearish && last <= priceA) status = 'da_fill';
    else if (!bearish && last < priceB) status = 'het_hieu_luc';
    else if (!bearish && last >= priceA) status = 'da_fill';
    return {
      type, status,
      swings: [
        { t: closed[a].t, price: priceA, cvd: cvd[a] },
        { t: closed[b].t, price: priceB, cvd: cvd[b] },
      ],
      text: `${DIV_VI[type]} trên khung ${tf} — ${status === 'dang_chay' ? 'đang chạy' : status === 'da_fill' ? 'đã fill' : 'hết hiệu lực'}.`,
    };
  };

  if (hi.length >= 2) {
    const [a, b] = [hi[hi.length - 2], hi[hi.length - 1]];
    if (closed[b].h > closed[a].h) {
      if (cvd[b] < cvd[a]) return mk('ban_thuong', a, b, closed[a].h, closed[b].h);
      if (cvd[b] > cvd[a]) return mk('an_mua', a, b, closed[a].h, closed[b].h);
    }
  }
  if (lo.length >= 2) {
    const [a, b] = [lo[lo.length - 2], lo[lo.length - 1]];
    if (closed[b].l < closed[a].l) {
      if (cvd[b] > cvd[a]) return mk('mua_thuong', a, b, closed[a].l, closed[b].l);
      if (cvd[b] < cvd[a]) return mk('an_ban', a, b, closed[a].l, closed[b].l);
    }
  }
  return null;
}

/**
 * Spot và hợp đồng: tính riêng, chỉ ghi "đồng thuận" khi CÙNG nghiêng một phía
 * trên nến đóng cùng giờ. Lệch thì ghi lệch — KHÔNG lấy trung bình, vì trung
 * bình của hai thị trường khác nhau không mô tả thị trường nào cả.
 */
export function spotVsPerp(
  spot: Candle[],
  perp: Candle[],
): { spot: number | null; perp: number | null; agree: boolean; text: string } {
  const s = spot.filter((c) => c.closed).slice(-1)[0];
  const p = perp.filter((c) => c.closed).slice(-1)[0];
  const ds = s ? barDelta(s) : null;
  const dp = p ? barDelta(p) : null;
  if (ds == null || dp == null) {
    return { spot: ds, perp: dp, agree: false, text: 'Thiếu delta một bên — không kết luận đồng thuận.' };
  }
  const sameBar = s && p ? s.t === p.t : false;
  const agree = sameBar && Math.sign(ds) === Math.sign(dp) && ds !== 0;
  return {
    spot: ds, perp: dp, agree,
    text: agree
      ? `Spot và hợp đồng cùng nghiêng ${ds > 0 ? 'mua' : 'bán'} trên nến đóng cùng giờ.`
      : !sameBar
        ? 'Nến đóng của spot và hợp đồng không cùng giờ — không kết luận đồng thuận.'
        : `Lệch: spot nghiêng ${ds > 0 ? 'mua' : 'bán'}, hợp đồng nghiêng ${dp > 0 ? 'mua' : 'bán'}.`,
  };
}
