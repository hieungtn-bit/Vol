import { SCORE_FLOOR, scoreSide, verdict, type ConfluenceInput, type DataStatus, type Verdict } from './confluence';
import { barDelta, findDivergence, hourFlow, type DeltaDivergence } from './deltaDiv';
import { referenceLayer, type Layers, type LayerProfile } from './layers';
import { isCoarse, toStep, type Layer } from './ruler';
import { feeInR } from './direct';
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
  /** R:R tới chốt 1 và chốt 2, TRƯỚC phí. */
  rr1: number;
  rr2: number;
  /**
   * R kỳ vọng SAU PHÍ của kế hoạch chốt 50/50, tính đúng như hàm mô phỏng:
   *   0.5×R(chốt1) + 0.5×R(chốt2) − phí quy ra R.
   * Đây là con số duy nhất đáng đọc: backtest cho thấy nhóm chạm cả hai mốc chỉ
   * đạt +0.22R trong khi nhóm dính cắt mất −1.12R, tức mục tiêu đang quá gần so
   * với cắt. Số này phơi bày điều đó ngay trên giao diện.
   */
  rrNet: number;
  /** Phí quy ra R với độ rộng cắt của chính kế hoạch này. */
  feeR: number;
}

/**
 * Trạng thái của một setup theo góc nhìn NGƯỜI THEO DÕI.
 *
 * Khác với `data_status` (nói về dữ liệu) và `gate.pass` (nói về đủ điều kiện
 * hay chưa). Ở đây cần bốn mức để người dùng biết nên nhìn cái nào:
 *   thieu_du_lieu  — không đánh giá được, đừng đọc gì từ nó.
 *   dang_theo_doi  — đủ dữ liệu, chưa có sự kiện mép nào đáng chờ.
 *   cho_xac_nhan   — đã có sự kiện mép, chỉ còn thiếu điều kiện mà một NẾN ĐÓNG
 *                    tiếp theo có thể giải quyết. Đây là chỗ đáng dán mắt vào.
 *   du_dieu_kien   — qua cửa, có kế hoạch thật.
 */
export type SetupStatus = 'thieu_du_lieu' | 'dang_theo_doi' | 'cho_xac_nhan' | 'du_dieu_kien';

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
  /** DATA_INSUFFICIENT / NO_SETUP / VALID_SETUP — không được trộn ba thứ này. */
  data_status: DataStatus;
  gate: { pass: boolean; fail_reasons: string[] };
  /** Kế hoạch THẬT. null khi chưa qua cửa — luật cứng, không đổi. */
  plan: TFPlan | null;
  /**
   * Kế hoạch DỰ KIẾN — hình học đã dựng được nhưng chưa qua cửa.
   *
   * Có để người theo dõi thấy trước mức giá sẽ vào, cắt, chốt và R:R sau phí,
   * chứ không phải để giao dịch. Giao diện phải ghi rõ nó là dự kiến; `plan`
   * vẫn null cho tới khi thật sự đủ điều kiện.
   */
  prospect: TFPlan | null;
  setup_status: SetupStatus;
  /** Còn thiếu ĐÚNG những điều kiện nào để lên mức tiếp theo. */
  missing_conditions: string[];
  /** Điểm còn thiếu bao nhiêu để chạm sàn. 0 khi đã đủ. */
  score_gap: number;
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

/**
 * Cụm dày gần nhất phía trước theo hướng lệnh.
 *
 * Phải tính cả cụm đang CHỨA điểm xuất phát, miễn là mép xa của nó còn nằm phía
 * trước. Bản trước dùng `n.low > from` / `n.high < from` nên khi giá đứng ngay
 * biên của một cụm dày lớn, chính cụm đó bị loại và máy kết luận "không có cụm
 * dày phía trước để chốt" — trong khi mục tiêu hiển nhiên là mép bên kia của nó.
 * Đây đúng là lớp lỗi so ĐỈNH thay vì so MÉP đã từng sửa ở `nextHVN`.
 */
function hvnAhead(hvn: Node[], from: number, up: boolean, minGap = 0): Node | null {
  const far = (n: Node) => (up ? n.high : n.low);
  const cands = hvn
    .filter((n) => (up ? far(n) > from + minGap : far(n) < from - minGap))
    .sort((a, b) => {
      const da = Math.abs((up ? Math.max(a.low, from) : Math.min(a.high, from)) - from);
      const db = Math.abs((up ? Math.max(b.low, from) : Math.min(b.high, from)) - from);
      return da - db;
    });
  return cands[0] ?? null;
}

/**
 * MỤC TIÊU: mép giá chạm tới trước. Ở ngoài cụm thì là mép gần; đang ở trong cụm
 * thì là mép bên kia.
 */
function nodeTarget(n: Node, from: number, up: boolean): number {
  if (from >= n.low && from <= n.high) return up ? n.high : n.low;
  return up ? n.low : n.high;
}

/**
 * CẮT: luôn là mép XA của cụm chặn — cắt phải nằm BÊN KIA cụm vừa từ chối, không
 * phải ở mép gần của nó. Dùng nhầm mép gần thì với một cụm nằm hẳn dưới vùng vào
 * lệnh, cắt rơi lên đúng mép trên của cụm, tức nằm ngay cạnh giá vào — sau khi
 * làm tròn về bước thì cắt TRÙNG entry, risk = 0, phí = 0 và mọi R:R thành rác.
 */
function nodeFarEdge(n: Node, up: boolean): number {
  return up ? n.high : n.low;
}

/**
 * "Không đặt cắt/chốt GIỮA cụm mỏng" — chữ then chốt là GIỮA.
 *
 * Một mức nằm sát mép cụm mỏng vẫn bám vào một tham chiếu thật (mép của cụm dày
 * liền kề). Cấm cả vùng mỏng thì cú fade ở trần vùng giá trị không bao giờ đặt
 * được cắt, vì phía trên trần theo định nghĩa là mỏng.
 */
function deepInsideBand(x: number, b: [number, number], tol: number): boolean {
  return x > b[0] + tol && x < b[1] - tol;
}

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
  rejection: { side: 'tren' | 'duoi' } | null,
): { plan: TFPlan | null; fails: string[] } {
  const fails: string[] = [];
  const { vp } = layer;
  const up = side === 'mua';
  const step = layer.step;
  const P = (x: number) => toStep(x, step);

  // Mép để vào là mép VỪA ĐƯỢC CHẠM HOẶC VỪA BỊ PHÁ, không phải "mép theo chiều
  // lệnh". Bản trước lấy VAL cho mọi lệnh mua: sau khi giá chấp nhận ra ngoài
  // phía TRÊN, lệnh mua bị đặt ở ĐÁY cụm — sai phía hoàn toàn so với chỗ giá vừa
  // bứt lên, và cách giá cả bề rộng cụm.
  //   · chấp nhận ngoài / vùng dịch → chờ kéo về mép đã bị phá (mục E: "vào nhịp
  //     kéo lại mép cụm cũ").
  //   · từ chối mép → fade ngay tại mép vừa bị từ chối.
  const brokenSide = state.state !== 'trong_vung' ? state.side : rejection?.side ?? null;
  const edge = brokenSide === 'tren' ? state.edge.vah
    : brokenSide === 'duoi' ? state.edge.val
    : up ? state.edge.val : state.edge.vah;
  const buffer = Math.max(step * 2, Math.abs(edge) * 0.002);
  const entry: [number, number] = up
    ? [P(edge - buffer), P(edge + buffer)]
    : [P(edge - buffer), P(edge + buffer)];

  // Cắt: sau HVN vừa từ chối. KHÔNG được nằm giữa điểm kiểm soát, KHÔNG giữa LVN.
  const guardFrom = up ? entry[0] : entry[1];
  const guardNode = hvnAhead(vp.hvn, guardFrom, !up);
  const slRaw = up
    ? (guardNode ? nodeFarEdge(guardNode, false) : entry[0]) - buffer
    : (guardNode ? nodeFarEdge(guardNode, true) : entry[1]) + buffer;
  let sl = P(slRaw);

  // Bảo đảm cứng: sau khi làm tròn, cắt phải cách vùng vào lệnh ÍT NHẤT một bước.
  // Không có ràng buộc này thì làm tròn có thể ép cắt trùng entry và risk = 0.
  if (up && sl >= entry[0]) sl = P(entry[0] - Math.max(buffer, step));
  if (!up && sl <= entry[1]) sl = P(entry[1] + Math.max(buffer, step));

  const tol = step;
  if (deepInsideBand(sl, layer.poc, 0)) fails.push('Cắt rơi vào giữa điểm kiểm soát.');
  for (const l of vp.lvn) {
    if (deepInsideBand(sl, bandOf(l), tol)) { fails.push('Cắt rơi vào giữa cụm mỏng.'); break; }
  }

  // Chốt 1: HVN phía trước. Không xuyên ≥ 2 HVN.
  const tpFrom = up ? entry[1] : entry[0];
  const target = hvnAhead(vp.hvn, tpFrom, up, step);
  if (!target) fails.push('Không có cụm dày phía trước để chốt 1.');
  const tp1 = target ? P(nodeTarget(target, tpFrom, up)) : P(up ? edge + buffer * 4 : edge - buffer * 4);

  const crossed = vp.hvn.filter((n) =>
    up ? n.low > entry[1] && n.high < tp1 : n.high < entry[0] && n.low > tp1).length;
  if (crossed >= 2) fails.push(`Đoạn tới chốt 1 xuyên ${crossed} cụm dày.`);

  const next = target ? hvnAhead(vp.hvn, tp1, up, step) : null;
  const tp2 = next ? P(up ? next.low : next.high) : P(up ? tp1 + buffer * 3 : tp1 - buffer * 3);

  for (const l of vp.lvn) {
    if (deepInsideBand(tp1, bandOf(l), tol)) { fails.push('Chốt 1 rơi vào giữa cụm mỏng.'); break; }
  }

  const trigger = up
    ? `nến ${tf} đóng trên ${P(entry[1])} sau khi giữ ${P(entry[0])}`
    : `nến ${tf} đóng dưới ${P(entry[0])} sau khi test ${P(entry[1])}`;

  // Hình học LUÔN được trả về, kể cả khi có lỗi — phía trên quyết định gọi nó là
  // kế hoạch thật hay chỉ là dự kiến. Trả null ở đây thì người theo dõi không
  // bao giờ thấy được mức giá của một setup đang hình thành.
  const entryRef = up ? entry[1] : entry[0];
  const risk = Math.abs(entryRef - sl);

  /**
   * Hình học THOÁI HOÁ thì không được trả ra dù chỉ là dự kiến.
   *
   * Một kế hoạch dự kiến phải là hình học HỢP LỆ mà chỉ còn thiếu điều kiện cửa.
   * Trả ra một bộ mức giá có cắt trùng entry hoặc chốt trùng entry là bày cho
   * người đọc một thứ không giao dịch được, tệ hơn là không bày gì.
   */
  const degenerate: string[] = [];
  if (!(risk > 0)) degenerate.push('Cắt trùng vùng vào lệnh — không tính được R.');
  if (up) {
    if (!(sl < entry[0])) degenerate.push('Cắt không nằm dưới vùng vào lệnh.');
    if (!(tp1 > entry[1])) degenerate.push('Chốt 1 không nằm trên vùng vào lệnh.');
    if (!(tp2 > tp1)) degenerate.push('Chốt 2 không xa hơn chốt 1.');
  } else {
    if (!(sl > entry[1])) degenerate.push('Cắt không nằm trên vùng vào lệnh.');
    if (!(tp1 < entry[0])) degenerate.push('Chốt 1 không nằm dưới vùng vào lệnh.');
    if (!(tp2 < tp1)) degenerate.push('Chốt 2 không xa hơn chốt 1.');
  }
  if (degenerate.length) return { plan: null, fails: [...fails, ...degenerate] };

  const feeR = feeInR(entryRef, risk) ?? 0;
  const rr1 = Math.abs(tp1 - entryRef) / risk;
  const rr2 = Math.abs(tp2 - entryRef) / risk;
  // Khớp ĐÚNG hàm mô phỏng: 50% ở chốt 1, 50% còn lại ở chốt 2.
  const rrNet = 0.5 * rr1 + 0.5 * rr2 - feeR;

  const round2 = (x: number) => Math.round(x * 100) / 100;
  // Phí quy ra R là số nhỏ (cỡ 0.01–0.4). Làm tròn 2 chữ số như các R khác thì
  // với cắt rộng nó thành 0.00 và người đọc tưởng lệnh không mất phí.
  const round4 = (x: number) => Math.round(x * 10000) / 10000;
  const built: TFPlan = {
    entry, trigger, sl, tp1, tp2, size,
    rr1: round2(rr1), rr2: round2(rr2), rrNet: round2(rrNet), feeR: round4(feeR),
  };
  return { plan: built, fails };
}

export interface TFReadInput {
  tf: TF;
  candles: Candle[];
  layers: Layers;
  last4hClosed: Candle | null;
  spotPerpAgree: boolean;
  fundingPoints: number;
  oi: OIInfo;
  /** Có dữ liệu taker perp cho nến này không. */
  hasPerpTaker: boolean;
  /** Có funding ĐÃ CHỐT tại thời điểm này không. */
  hasFunding: boolean;
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

  const rej = edgeRejection(layer, closed);
  // Vế phái sinh chỉ chấm được khi có dữ liệu perp. Thiếu thì phải nói là THIẾU,
  // không được lặng lẽ cộng 0 rồi trình bày như thị trường không có cơ hội.
  const missing: string[] = [];
  if (!i.hasPerpTaker) missing.push('taker perp');
  if (!i.hasFunding) missing.push('funding');

  const base: ConfluenceInput = {
    tf: i.tf, layer, state, closed, last, volMedian20, tfDelta,
    spotPerpAgree: i.spotPerpAgree, fundingPoints: i.fundingPoints,
    divergence: div, oi: i.oi, slPct: null,
    mixedLayer: layer.note != null || (layer.split != null && isCoarse(layer.layer)),
    rejection: rej ? { side: rej.side } : null,
    dataOk: missing.length === 0,
    missing,
  };

  // Quyết định hướng trước, rồi mới xin quyền theo hướng đó (15m phụ thuộc hướng).
  // Xin quyền theo ĐÚNG phía đang thắng điểm. Bản trước dùng một ternary có hai
  // nhánh giống hệt nhau ('mua' : 'mua'), nên với khung 15m thì phép kiểm "không
  // mở ngược nến 4 giờ" luôn được kiểm cho phía mua — sai phía một nửa số lần.
  const probe = verdict(base, { fullSize: true, halfSize: true, blocked: null }, i.scoreFloor);
  const side: 'mua' | 'ban' = probe.bias !== 'dung_ngoai'
    ? probe.bias
    : scoreSide(base, 'mua').score >= scoreSide(base, 'ban').score ? 'mua' : 'ban';
  const perm = permission(i.tf, closed, i.last4hClosed, side);
  const v: Verdict = verdict(base, perm, i.scoreFloor);

  const fail: string[] = [...v.reasons];

  // Dựng hình học MỘT LẦN cho mọi trường hợp. Phía dưới mới quyết định nó là kế
  // hoạch thật hay chỉ là dự kiến để theo dõi.
  const geomSide: 'mua' | 'ban' = v.bias !== 'dung_ngoai' ? v.bias : side;
  const built = buildPlan(layer, state, geomSide, v.size ?? 'kho_nua', last, i.tf, base.rejection);

  if (isCoarse(layer.layer)) fail.push('Mép lệnh đang lấy từ lớp dài, không phải lớp 24 giờ / sau-event.');
  if (state.state === 'trong_vung' && !base.rejection) {
    fail.push('Còn trong vùng — lệnh mới không mở.');
  }
  fail.push(...built.fails);

  const plan: TFPlan | null = null;
  const floorUsed = i.scoreFloor ?? SCORE_FLOOR;
  const pass = built.plan != null
    && v.dataStatus === 'VALID_SETUP'
    && v.score >= floorUsed
    && fail.length === 0;

  // Phân loại cho người theo dõi.
  const scoreGap = Math.max(0, floorUsed - v.score);
  const geometryOk = built.plan != null && built.fails.length === 0;
  // "Chờ xác nhận" = đã có sự kiện mép thật (từ chối / chấp nhận / vùng dịch),
  // hình học dựng được, và thứ còn thiếu là điều một NẾN ĐÓNG có thể giải quyết.
  const hasEvent = base.rejection != null || state.state !== 'trong_vung';
  const setupStatus: SetupStatus = v.dataStatus === 'DATA_INSUFFICIENT'
    ? 'thieu_du_lieu'
    : pass
      ? 'du_dieu_kien'
      : hasEvent && geometryOk && scoreGap <= 2
        ? 'cho_xac_nhan'
        : 'dang_theo_doi';

  const missingNow: string[] = [];
  if (v.dataStatus === 'DATA_INSUFFICIENT') missingNow.push(...v.reasons);
  else {
    if (scoreGap > 0) missingNow.push(`thiếu ${scoreGap.toFixed(1)} điểm để chạm sàn ${floorUsed}`);
    for (const f of fail) if (!f.includes('dưới sàn')) missingNow.push(f);
    if (!hasEvent) missingNow.push('chưa có sự kiện mép nào (chưa từ chối, chưa chấp nhận ra ngoài)');
  }
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
    data_status: v.dataStatus,
    gate: { pass, fail_reasons: pass ? [] : [...new Set(fail)] },
    plan: pass ? built.plan : null,
    prospect: pass ? null : built.plan,
    setup_status: setupStatus,
    missing_conditions: [...new Set(missingNow)],
    score_gap: Number(scoreGap.toFixed(2)),
    state_text: state.text,
    watch: rej
      ? `Vừa từ chối mép ${rej.side === 'tren' ? 'trên' : 'dưới'} ${P(rej.level)}. `
        + `Xem lại khi nến ${i.tf} đóng ngoài ${P(state.edge.val)}–${P(state.edge.vah)}.`
      : `Xem lại khi nến ${i.tf} đóng ngoài ${P(state.edge.val)}–${P(state.edge.vah)}.`,
    lines: v.lines,
  };
}

export { STATE_VI, insidePoc };
