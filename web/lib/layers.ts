import { findValueMigration } from './migration';
import { fitProfile, pocBand, type FittedProfile, type Layer } from './ruler';
import { computeVolumeProfile } from './volumeProfile';
import type { Candle, TF } from './types';

// ============================================================
// NĂM LỚP THỜI GIAN — không lớp nào được gộp với lớp nào
//
// Lỗi cũ: mỗi khung dựng ĐÚNG MỘT profile trên một cửa sổ trượt cố định (15m:192
// nến, 1h:168, 4h:126, 1d:90). Cửa sổ 4h 126 nến trải hơn ba tuần, nên vùng giá
// trị của nó nuốt cả vách cũ 0.169 lẫn cụm phiên 0.162–0.164 và ra 0.146–0.171.
// Mép đó không phải mép đang sống; đặt lệnh theo nó là đặt theo một vùng đã chết.
//
// Cách sửa không phải là chỉnh cửa sổ cho khéo hơn, mà là TÁCH HẲN: mỗi lớp trả
// lời đúng một câu hỏi, và câu "đặt lệnh ở đâu" chỉ được hỏi lớp 24 giờ / sau-
// event / phiên. Lớp 10 ngày và 48 giờ chỉ để biết vách cũ nằm đâu.
// ============================================================

/** Số nến 15m của từng lớp có lookback cố định. */
export const LOOKBACK_15M: Partial<Record<Layer, number>> = {
  '10d': 960,
  '48h': 192,
  '24h': 96,
};

/** Cây 1 giờ phải nặng gấp bấy nhiêu lần trung bình phiên mới gọi là event. */
export const EVENT_MULT = 3;

export interface ClusterSplit {
  /** Vùng giá trị TRƯỚC cú dịch — cái mà giá đã rời khỏi. */
  oldVA: { low: number; high: number };
  /** Điểm kiểm soát của cụm cũ, dạng dải. Phải đi kèm oldVA, nếu không thì
   *  trạng thái đọc theo cụm cũ mà điểm kiểm soát lại lấy từ profile trộn —
   *  chữ nói một đằng số nói một nẻo, đúng lỗi mà cả việc này đang đi sửa. */
  oldPoc: [number, number];
  /** Vùng giá trị SAU cú dịch. */
  newVA: { low: number; high: number };
  oldVol: number;
  newVol: number;
}

export interface LayerProfile extends FittedProfile {
  /** Điểm kiểm soát dạng DẢI. */
  poc: [number, number];
  /** Số nến đã đóng dùng để dựng. */
  bars: number;
  /** Mốc thời gian đầu / cuối của lớp. */
  from: number;
  to: number;
  /**
   * Cửa sổ này có chứa một cú dịch cụm không.
   *
   * Khi có, VA của cả cửa sổ là VA TRỘN — nó ôm cả cụm cũ lẫn cụm mới và không
   * mô tả đúng chỗ nào cả. Đúng ca BTC ngày: giá 79700, cụm cũ 59500–67000,
   * cụm mới 79000–80000, và VA trộn nuốt cả hai nên máy kết luận "đang ở giữa
   * vùng giá trị" — sai hoàn toàn. Có split thì trạng thái phải đọc theo cụm
   * mà giá VỪA RỜI, không theo VA trộn.
   */
  split: ClusterSplit | null;
}

export interface EventBar {
  /** Cây 1 giờ đã đóng gây ra cú dịch. */
  candle: Candle;
  /** Volume của nó gấp bao nhiêu lần trung bình phiên (đã loại chính nó). */
  mult: number;
}

/**
 * Tìm cây event: cây 1 giờ ĐÃ ĐÓNG có volume > 3× trung bình các cây 1 giờ đóng
 * cùng phiên, và trung bình đó phải LOẠI CHÍNH CÂY ĐÓ ra — nếu không, một cây
 * khổng lồ tự kéo trung bình lên và tự che mình.
 *
 * Trả về cây GẦN NHẤT thoả điều kiện, vì cụm đang sống là cụm hình thành sau cú
 * dịch mới nhất.
 */
export function findEventBar(c1h: Candle[], lookback = 48): EventBar | null {
  const closed = c1h.filter((c) => c.closed).slice(-lookback);
  if (closed.length < 6) return null;

  for (let i = closed.length - 1; i >= 0; i--) {
    const others = closed.filter((_, k) => k !== i);
    if (!others.length) continue;
    const mean = others.reduce((s, c) => s + c.v, 0) / others.length;
    if (mean > 0 && closed[i].v > EVENT_MULT * mean) {
      return { candle: closed[i], mult: closed[i].v / mean };
    }
  }
  return null;
}

/** Mốc mở của phiên 4 giờ đang chạy, tính theo UTC (khớp mốc nến 4h của sàn). */
export function session4hOpen(now: number): number {
  const h = 4 * 3_600_000;
  return Math.floor(now / h) * h;
}

/** Tách cụm cũ / cụm mới khi cửa sổ chứa một cú dịch có vùng trống ở giữa. */
export function splitClusters(closed: Candle[], step: number): ClusterSplit | null {
  const m = findValueMigration(closed, step);
  if (m.from <= 0) return null;
  const before = closed.slice(0, m.from);
  const after = closed.slice(m.from);
  const a = computeVolumeProfile(before, { binSize: step, minBins: 6 });
  const b = computeVolumeProfile(after, { binSize: step, minBins: 6 });
  if (!a || !b) return null;
  return {
    oldVA: { low: a.va70.low, high: a.va70.high },
    oldPoc: pocBand(before, a),
    newVA: { low: b.va70.low, high: b.va70.high },
    oldVol: a.totalVol,
    newVol: b.totalVol,
  };
}

function build(candles: Candle[], layer: Layer, price?: number): LayerProfile | null {
  const closed = candles.filter((c) => c.closed);
  if (closed.length < 4) return null;
  const f = fitProfile(closed, layer, price);
  if (!f) return null;
  return {
    ...f,
    poc: pocBand(closed, f.vp),
    bars: closed.length,
    from: closed[0].t,
    to: closed[closed.length - 1].t,
    split: splitClusters(closed, f.step),
  };
}

export interface Layers {
  '10d': LayerProfile | null;
  '48h': LayerProfile | null;
  '24h': LayerProfile | null;
  after_event: LayerProfile | null;
  session_4h: LayerProfile | null;
  event: EventBar | null;
}

/**
 * Dựng cả năm lớp. `c15m` phải đủ dài cho lớp 10 ngày (960 nến); thiếu thì lớp
 * đó trả null chứ không lấy tạm cửa sổ ngắn hơn rồi gọi là 10 ngày.
 */
export function buildLayers(c15m: Candle[], c1h: Candle[], now: number): Layers {
  const closed15 = c15m.filter((c) => c.closed);
  const price = closed15.length ? closed15[closed15.length - 1].c : undefined;

  const tail = (n: number) => (closed15.length >= n ? closed15.slice(-n) : null);

  const event = findEventBar(c1h);
  const afterEvent = event
    ? closed15.filter((c) => c.t >= event.candle.t)
    : null;

  const sOpen = session4hOpen(now);
  const session = closed15.filter((c) => c.t >= sOpen);

  const t10 = tail(LOOKBACK_15M['10d']!);
  const t48 = tail(LOOKBACK_15M['48h']!);
  const t24 = tail(LOOKBACK_15M['24h']!);

  return {
    '10d': t10 ? build(t10, '10d', price) : null,
    '48h': t48 ? build(t48, '48h', price) : null,
    '24h': t24 ? build(t24, '24h', price) : null,
    after_event: afterEvent && afterEvent.length >= 4 ? build(afterEvent, 'after_event', price) : null,
    session_4h: session.length >= 4 ? build(session, 'session_4h', price) : null,
    event,
  };
}

/**
 * Lớp tham chiếu của TỪNG khung. Bốn khung độc lập nghĩa là bốn khung được
 * quyền nhìn vào những lớp khác nhau — nếu cả bốn cùng đọc một lớp thì chúng
 * không độc lập, chúng chỉ là một câu trả lời in ra bốn lần.
 *
 * Khung nhỏ hỏi "vùng đang sống ở đâu" → phiên / sau-event / 24 giờ.
 * Khung lớn hỏi "vùng của cả chu kỳ ở đâu" → 48 giờ / 10 ngày.
 */
const LAYER_PRIORITY: Record<TF, Layer[]> = {
  // Khung nhỏ đặt lệnh → chỉ lớp ngắn, đúng luật "lớp 10 ngày / 48 giờ không
  // được dùng đặt entry".
  '15m': ['session_4h', 'after_event', '24h'],
  '1h': ['after_event', '24h', 'session_4h'],
  // Khung lớn không đặt lệnh, nên được phép nhìn lớp dài — và PHẢI nhìn lớp
  // dài, vì "vùng ngày" của khung 1 ngày không thể là một vùng 48 giờ.
  '4h': ['48h', '24h', 'after_event'],
  '1d': ['10d', '48h'],
};

export function referenceLayer(l: Layers, tf: TF): LayerProfile | null {
  const order = LAYER_PRIORITY[tf];
  const get = (k: Layer) => (l as unknown as Record<Layer, LayerProfile | null>)[k];
  // Ưu tiên lớp đo được sạch (note == null); hết sạch thì mới lấy lớp có ghi chú.
  for (const k of order) { const x = get(k); if (x && x.note == null) return x; }
  for (const k of order) { const x = get(k); if (x) return x; }
  // Lịch sử quá ngắn để dựng lớp ưu tiên (mã mới niêm yết, hoặc backtest cắt lát
  // ngắn). Lùi về lớp bất kỳ còn dựng được — im lặng trả null thì cả khung biến
  // mất khỏi kết quả mà không ai biết vì sao.
  const any = [l['48h'], l['24h'], l.after_event, l.session_4h, l['10d']]
    .filter((x): x is LayerProfile => x != null);
  return any[0] ?? null;
}

/** Giữ lại cho các chỗ chỉ cần "lớp được phép đặt lệnh" nói chung. */
export function tradingLayer(l: Layers): LayerProfile | null {
  const cands = [l.after_event, l['24h'], l.session_4h].filter(
    (x): x is LayerProfile => x != null && x.note == null,
  );
  return cands[0] ?? l['24h'] ?? l.after_event ?? l.session_4h ?? null;
}
