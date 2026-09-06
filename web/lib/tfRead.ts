import { SCORE_FLOOR, verdict, type ConfluenceInput, type Verdict } from './confluence';
import { barDelta, findDivergence, hourFlow, type DeltaDivergence } from './deltaDiv';
import { referenceLayer, type Layers, type LayerProfile } from './layers';
import { isCoarse, toStep, type Layer } from './ruler';
import { STATE_VI, edgeRejection, insidePoc, readState, type StateRead } from './vpState';
import { median } from './priceAction';
import type { Candle, Node, OIInfo, ScoreLine, TF } from './types';

// ============================================================
// ĐỌC MỘT KHUNG — nơi duy nhất ghép thước, trạng thái, điểm và kế hoạch.
//
// Mọi câu chữ của khung này phải sinh ra từ đúng một `StateRead` và đúng một
// `Verdict`. Đó là cách chặn lỗi "một khung ra hai câu trái nhau": không có
// nhánh nào khác được phép tự mô tả vị trí giá.
// ============================================================

export interface TFPlan {
  entry: [number, number];
  trigger: string;
  sl: number;
  tp1: number;
  tp2: number;
  size: 'kho_nua' | 'kho_du';
}

export interface TFRead {
  tf: TF;
  state: 'trong_vung' | 'chap_nhan_ngoai' | 'vung_dich';
  bias: 'dung_ngoai' | 'mua' | 'ban';
  layer: Layer;
  poc: [number, number];
  vah: number;
  val: number;
  hvn: [number, number][];
  lvn: [number, number][];
  vol_candles: { time: number; o: number; h: number; l: number; c: number; vol: number; delta: number | null }[];
  delta_div: null | { type: string; swings: { t: number; price: number; cvd: number }[]; status: string };
  score: number;
  gate: { pass: boolean; fail_reasons: string[] };
  plan: TFPlan | null;
  /** Câu mô tả trạng thái — sinh từ chính `state`, không từ nhánh nào khác. */
  state_text: string;
  /** Mép cần đóng để xem lại, in cả khi đứng ngoài. */
  watch: string;
  lines: ScoreLine[];
}

/** Quyền ra lệnh theo khung — bảng đa khung của đề bài. */
function permission(
  tf: TF,
  closed: Candle[],
  last4hClosed: Candle | null,
  side: 'mua' | 'ban',
): { fullSize: boolean; halfSize: boolean; blocked: string | null } {
  if (tf === '1d') {
    return { fullSize: false, halfSize: false, blocked: 'Khung 1 ngày chỉ định hướng lớn, không vào lệnh.' };
  }
  if (!closed.length) return { fullSize: false, halfSize: false, blocked: 'Chưa có nến đóng.' };

  if (tf === '4h') {
    return { fullSize: false, halfSize: false, blocked: 'Khung 4 giờ chỉ lọc swing, không tự phát lệnh.' };
  }
  if (tf === '1h') return { fullSize: true, halfSize: true, blocked: null };

  // 15m: chỉ khổ nửa, và KHÔNG được mở ngược nến 4 giờ đóng gần nhất.
  if (last4hClosed) {
    const up4h = last4hClosed.c >= last4hClosed.o;
    if ((side === 'mua' && !up4h) || (side === 'ban' && up4h)) {
      return {
        fullSize: false, halfSize: false,
        blocked: 'Khung 15 phút không được mở ngược nến 4 giờ đóng gần nhất.',
      };
    }
  }
  return { fullSize: false, halfSize: true, blocked: null };
}

const bandOf = (n: Node): [number, number] => [n.low, n.high];

/** HVN gần nhất phía trước theo hướng lệnh. */
function hvnAhead(hvn: Node[], from: number, up: boolean): Node | null {
  const cands = hvn
    .filter((n) => (up ? n.low > from : n.high < from))
    .sort((a, b) => (up ? a.low - b.low : b.high - a.high));
  return cands[0] ?? null;
}

const insideBand = (x: number, b: [number, number]) => x >= b[0] && x <= b[1];

/**
 * Dựng kế hoạch. Trả null khi bất kỳ luật cứng nào không thoả — và mỗi lần trả
 * null đều kèm lý do, không im lặng.
 */
function buildPlan(
  layer: LayerProfile,
  state: StateRead,
  side: 'mua' | 'ban',
  size: 'kho_nua' | 'kho_du',
  last: number,
  tf: TF,
): { plan: TFPlan | null; fails: string[] } {
  const fails: string[] = [];
  const { vp } = layer;
  const up = side === 'mua';
  const step = layer.step;
  const P = (x: number) => toStep(x, step);

  // Mép để vào: mép cụm theo chiều lệnh.
  const edge = up ? state.edge.val : state.edge.vah;
  const buffer = Math.max(step * 2, Math.abs(edge) * 0.002);
  const entry: [number, number] = up
    ? [P(edge - buffer), P(edge + buffer)]
    : [P(edge - buffer), P(edge + buffer)];

  // Cắt: sau HVN vừa từ chối. KHÔNG được nằm giữa điểm kiểm soát, KHÔNG giữa LVN.
  const guardNode = hvnAhead(vp.hvn, up ? entry[0] : entry[1], !up);
  const slRaw = up
    ? (guardNode ? guardNode.low : entry[0]) - buffer
    : (guardNode ? guardNode.high : entry[1]) + buffer;
  const sl = P(slRaw);

  if (insideBand(sl, layer.poc)) fails.push('Cắt rơi vào giữa điểm kiểm soát.');
  for (const l of vp.lvn) {
    if (insideBand(sl, bandOf(l))) { fails.push('Cắt rơi vào giữa cụm mỏng.'); break; }
  }

  // Chốt 1: HVN phía trước. Không xuyên ≥ 2 HVN.
  const target = hvnAhead(vp.hvn, up ? entry[1] : entry[0], up);
  if (!target) fails.push('Không có cụm dày phía trước để chốt 1.');
  const tp1 = target ? P(up ? target.low : target.high) : P(up ? edge + buffer * 4 : edge - buffer * 4);

  const crossed = vp.hvn.filter((n) =>
    up ? n.low > entry[1] && n.high < tp1 : n.high < entry[0] && n.low > tp1).length;
  if (crossed >= 2) fails.push(`Đoạn tới chốt 1 xuyên ${crossed} cụm dày.`);

  const next = target ? hvnAhead(vp.hvn, tp1, up) : null;
  const tp2 = next ? P(up ? next.low : next.high) : P(up ? tp1 + buffer * 3 : tp1 - buffer * 3);

  for (const l of vp.lvn) {
    if (insideBand(tp1, bandOf(l))) { fails.push('Chốt 1 rơi vào giữa cụm mỏng.'); break; }
  }

  const trigger = up
    ? `nến ${tf} đóng trên ${P(entry[1])} sau khi giữ ${P(entry[0])}`
    : `nến ${tf} đóng dưới ${P(entry[0])} sau khi test ${P(entry[1])}`;

  if (fails.length) return { plan: null, fails };
  return { plan: { entry, trigger, sl, tp1, tp2, size }, fails };
}

export interface TFReadInput {
  tf: TF;
  candles: Candle[];
  layers: Layers;
  last4hClosed: Candle | null;
  spotPerpAgree: boolean;
  fundingPoints: number;
  oi: OIInfo;
  /** Hạ sàn điểm — chỉ dùng để chẩn đoán trong backtest. */
  scoreFloor?: number;
}

export function readTF(i: TFReadInput): TFRead | null {
  const closed = i.candles.filter((c) => c.closed);
  if (closed.length < 6) return null;

  const layer = referenceLayer(i.layers, i.tf);
  if (!layer) return null;

  const last = closed[closed.length - 1].c;
  const state = readState(layer, closed, i.tf);
  const div = findDivergence(closed, i.tf);
  const tfDelta = barDelta(closed[closed.length - 1]);
  const volMedian20 = median(closed.slice(-20).map((c) => c.v));

  const base: ConfluenceInput = {
    tf: i.tf, layer, state, closed, last, volMedian20, tfDelta,
    spotPerpAgree: i.spotPerpAgree, fundingPoints: i.fundingPoints,
    divergence: div, oi: i.oi, slPct: null,
    mixedLayer: layer.note != null || (layer.split != null && isCoarse(layer.layer)),
  };

  // Quyết định hướng trước, rồi mới xin quyền theo hướng đó (15m phụ thuộc hướng).
  const probe = verdict(base, { fullSize: true, halfSize: true, blocked: null }, i.scoreFloor);
  const side = probe.bias === 'dung_ngoai' ? (probe.lines.length ? 'mua' : 'mua') : probe.bias;
  const perm = permission(i.tf, closed, i.last4hClosed, side as 'mua' | 'ban');
  const v: Verdict = verdict(base, perm, i.scoreFloor);

  const fail: string[] = [...v.reasons];
  let plan: TFPlan | null = null;

  if (v.bias !== 'dung_ngoai' && v.size) {
    // Cửa siết — bốn điều kiện mới của đề bài.
    if (isCoarse(layer.layer)) fail.push('Mép lệnh đang lấy từ lớp dài, không phải lớp 24 giờ / sau-event.');
    if (state.state === 'trong_vung') fail.push('Còn trong vùng — lệnh mới không mở.');
    const built = buildPlan(layer, state, v.bias, v.size, last, i.tf);
    fail.push(...built.fails);
    if (!fail.length) plan = built.plan;
  }

  const pass = plan != null && v.score >= (i.scoreFloor ?? SCORE_FLOOR) && fail.length === 0;
  const rej = edgeRejection(layer, closed);
  const P = (x: number) => toStep(x, layer.step);

  return {
    tf: i.tf,
    state: state.state,
    bias: pass ? v.bias : 'dung_ngoai',
    layer: layer.layer,
    poc: [P(state.poc[0]), P(state.poc[1])],
    vah: P(state.edge.vah),
    val: P(state.edge.val),
    hvn: layer.vp.hvn.map((n) => [P(n.low), P(n.high)] as [number, number]),
    lvn: layer.vp.lvn.map((n) => [P(n.low), P(n.high)] as [number, number]),
    vol_candles: hourFlow(closed, 12).map((r) => ({
      time: r.t, o: r.o, h: r.h, l: r.l, c: r.c, vol: r.vol, delta: r.delta,
    })),
    delta_div: div ? { type: div.type, swings: div.swings, status: div.status } : null,
    score: Number(v.score.toFixed(2)),
    gate: { pass, fail_reasons: pass ? [] : [...new Set(fail)] },
    plan: pass ? plan : null,
    state_text: state.text,
    watch: rej
      ? `Vừa từ chối mép ${rej.side === 'tren' ? 'trên' : 'dưới'} ${P(rej.level)}. `
        + `Xem lại khi nến ${i.tf} đóng ngoài ${P(state.edge.val)}–${P(state.edge.vah)}.`
      : `Xem lại khi nến ${i.tf} đóng ngoài ${P(state.edge.val)}–${P(state.edge.vah)}.`,
    lines: v.lines,
  };
}

export { STATE_VI, insidePoc };
