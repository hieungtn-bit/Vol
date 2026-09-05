import { fmtPrice } from './format';
import { wickCluster } from './priceAction';
import type {
  Bias, Candle, Confluence, DeltaInfo, Derivatives, PriceAction, Recommendation,
  ScoreLine, SizeHint, Stage, TF, VolumeProfile,
} from './types';
import { OI_READ_VI } from './derivatives';
import { hvnCrossings, inMidValue, nextHVN } from './volumeProfile';

// ============================================================
// decideBias — nơi mọi luật cứng được thi hành.
//
//  1. WAIT là kết luận hợp lệ. Không ép Long/Short.
//  2. Cấm entry giữa value (POC / lõi VA). Chỉ mép.
//  3. TP1 bắt buộc nằm trong VA hoặc tại POC.
//  4. SL = mức thesis chết: ngoài cụm wick + buffer. Không nới cho khỏi stop.
//  5. Mỗi TF độc lập. TF nhỏ không được lây bias sang TF lớn.
//  6. Score < 7 → WAIT, dù setup "trông đẹp".
// ============================================================

export interface HTFContext {
  /** Bias của TF lớn hơn liền kề, để phát hiện counter-trend. */
  bias: Bias;
  trendUp: boolean;
  trendDown: boolean;
  /** Sàn/trần range HTF — điều kiện mở runner. */
  rangeHigh: number | null;
  rangeLow: number | null;
  tf: TF | null;
}

export interface DecideInput {
  symbol: string;
  tf: TF;
  candles: Candle[];
  vp: VolumeProfile;
  pa: PriceAction;
  delta: DeltaInfo;
  deriv: Derivatives;
  htf: HTFContext | null;
  /** TF này đã có ít nhất một nến đóng chưa. 1D chỉ đổi khi đóng ngày. */
  hasClosedBar: boolean;
  last: number;
}

const NEAR = 0.004;          // 0.4% coi là "chạm mép"
const MIN_RR1 = 1.2;         // dưới ngưỡng này là kèo tồi
const SL_WIDE_PCT = 3;       // SL > 3% giá → cảnh báo đỏ

const TRIGGER_TF: Record<TF, string> = {
  '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D',
};

function near(a: number, b: number, tol = NEAR): boolean {
  return Math.abs(a - b) / b <= tol;
}

// ------------------------------------------------------------
// 1. Xác định STAGE — giá đang đứng ở đâu so với value
// ------------------------------------------------------------

export function classifyStage(vp: VolumeProfile, pa: PriceAction, last: number): Stage {
  const { low: val, high: vah } = vp.va70;

  // Chấp nhận giá ngoài VA: đóng ngoài + không phải wick grab
  if (last > vah && pa.acceptedOutside === 'up') return 'breakout';
  if (last < val && pa.acceptedOutside === 'down') return 'breakdown';

  // Giá đã rời hẳn value của cửa sổ này (> 1.2 ATR ngoài mép) mà KHÔNG phải vừa
  // accept: mép của profile này nằm quá xa, mọi TP bám vào nó đều phải xuyên vài
  // HVN. Không có kèo — đọc lại ở TF nhỏ hơn. Đây là WAIT, không phải "fail mép".
  const outside = pa.atr > 0
    ? (last > vah ? (last - vah) / pa.atr : last < val ? (val - last) / pa.atr : 0)
    : 0;
  if (outside > 1.2) return 'mid-range';

  // Luật cứng: đứng ở lõi VA thì không có mép nào để bám.
  // Wick lên VAH rồi rơi về giữa value cũng không phải kèo — nó là mid-range.
  if (inMidValue(vp, last)) return 'mid-range';

  // Mép trên: chạm/vượt VAH bằng wick rồi đóng lại trong VA
  const testedHigh = pa.range.high >= vah * (1 - NEAR) || near(last, vah);
  const testedLow = pa.range.low <= val * (1 + NEAR) || near(last, val);

  if (last <= vah && testedHigh && last >= vp.poc) return 'edge-fail';
  if (last >= val && testedLow && last <= vp.poc) return 'edge-hold';

  // Ngoài VA nhưng chưa accept (wick ra rồi đóng trong) → vẫn là mép
  if (last > vah) return 'edge-fail';
  if (last < val) return 'edge-hold';

  return 'mid-range';
}

// ------------------------------------------------------------
// 2. Cổng phát lệnh theo TF (§4 "Luật phát lệnh")
// ------------------------------------------------------------

interface Gate { pass: boolean; why: string }

function shortGate(inp: DecideInput, stage: Stage): Gate {
  const { tf, pa, vp, last, candles } = inp;
  const closed = candles.filter((c) => c.closed);
  const lastBar = closed[closed.length - 1];
  if (!lastBar) return { pass: false, why: 'chưa có nến đóng' };

  if (tf === '15m') {
    // 15m Short CHỈ khi: test VAH/equal high + đóng dưới HVN đầu tiên
    const testedVah = pa.range.high >= vp.va70.high * (1 - NEAR);
    const testedEqHigh = pa.equalHighs.some((p) => pa.range.high >= p * (1 - NEAR));
    const firstHvnAbove = nextHVN(vp, last, 1);
    const closedUnderNode = firstHvnAbove ? lastBar.c < firstHvnAbove.low : lastBar.c < vp.va70.high;
    if (!(testedVah || testedEqHigh)) return { pass: false, why: 'chưa test VAH/equal high' };
    if (!closedUnderNode) return { pass: false, why: 'chưa đóng dưới HVN đầu tiên phía trên' };
    return { pass: true, why: 'test VAH/equal high + đóng dưới HVN đầu' };
  }

  if (tf === '1h' || tf === '4h') {
    if (!inp.hasClosedBar) return { pass: false, why: `chưa có nến ${TRIGGER_TF[tf]} đóng` };
    if (lastBar.c >= lastBar.o && stage !== 'breakdown') {
      return { pass: false, why: `nến ${TRIGGER_TF[tf]} cuối đóng xanh — không short theo` };
    }
    return { pass: true, why: `nến ${TRIGGER_TF[tf]} đã đóng xác nhận` };
  }

  // 1D: chỉ đổi khi đóng ngày
  if (!inp.hasClosedBar) return { pass: false, why: 'chưa đóng nến ngày' };
  if (stage !== 'edge-fail' && stage !== 'breakdown') {
    return { pass: false, why: '1D chưa phá cấu trúc — intraday không in 1D Short' };
  }
  return { pass: true, why: 'nến ngày đã đóng xác nhận' };
}

function longGate(inp: DecideInput, stage: Stage): Gate {
  const { tf, pa, vp, last, candles } = inp;
  const closed = candles.filter((c) => c.closed);
  const lastBar = closed[closed.length - 1];
  if (!lastBar) return { pass: false, why: 'chưa có nến đóng' };

  if (tf === '15m') {
    // 15m Long CHỈ khi: giữ VAL/POC cũ + đóng xanh + KHÔNG phải long đuổi HH
    const heldVal = pa.range.low <= vp.va70.low * (1 + NEAR) || near(last, vp.va70.low);
    const heldPoc = near(last, vp.poc, NEAR * 1.5) && last >= vp.poc * (1 - NEAR);
    const green = lastBar.c > lastBar.o;
    const chasingHH = pa.rangePos > 80 || pa.acceptedOutside === 'up';
    if (!(heldVal || heldPoc)) return { pass: false, why: 'chưa giữ VAL/POC' };
    if (!green) return { pass: false, why: 'nến cuối không đóng xanh' };
    if (chasingHH) return { pass: false, why: 'đang ở đỉnh range — long đuổi HH, cấm' };
    return { pass: true, why: 'giữ VAL/POC + đóng xanh, không đuổi đỉnh' };
  }

  if (tf === '1h' || tf === '4h') {
    if (!inp.hasClosedBar) return { pass: false, why: `chưa có nến ${TRIGGER_TF[tf]} đóng` };
    if (lastBar.c <= lastBar.o && stage !== 'breakout') {
      return { pass: false, why: `nến ${TRIGGER_TF[tf]} cuối đóng đỏ — không long theo` };
    }
    return { pass: true, why: `nến ${TRIGGER_TF[tf]} đã đóng xác nhận` };
  }

  if (!inp.hasClosedBar) return { pass: false, why: 'chưa đóng nến ngày' };
  if (stage !== 'edge-hold' && stage !== 'breakout') {
    return { pass: false, why: '1D chưa phá cấu trúc — intraday không in 1D Long' };
  }
  return { pass: true, why: 'nến ngày đã đóng xác nhận' };
}

// ------------------------------------------------------------
// 3. Đặt số: Entry / SL / TP1 / TP2
// ------------------------------------------------------------

export interface Levels {
  entry: [number, number];
  sl: number;
  tp1: number;
  tp2: number;
  runner: string | null;
  tp1InVA: boolean;
  crossings: number;
}

/** Node đủ dày để làm nam châm giá. Node 1.2% chỉ đủ để gọi là HVN, chưa đủ làm TP. */
const MAJOR_NODE_SHARE = 0.02;

/**
 * Các NAM CHÂM trong value — nơi giá thật sự bị hút tới, dùng làm bậc TP.
 * Chỉ nhận VA edge, POC, giữa VA và đỉnh của HVN đủ dày. KHÔNG nhận mọi biên node:
 * trên profile bin mịn chúng nằm sát nhau và TP1 sẽ rơi vào nhiễu, cách entry
 * đúng vài bin — TP kiểu đó vừa không phải "mép VA / POC", vừa làm RR vô nghĩa.
 */
function vaReferences(vp: VolumeProfile): number[] {
  const midVA = (vp.va70.low + vp.va70.high) / 2;
  const inside = (x: number) => x >= vp.va70.low && x <= vp.va70.high;
  const refs = [vp.va70.low, vp.va70.high, vp.poc, midVA];
  for (const n of vp.hvn) {
    if (n.share >= MAJOR_NODE_SHARE && inside(n.price)) refs.push(n.price);
  }
  return [...new Set(refs.filter(inside))].sort((a, b) => a - b);
}

/** Bậc GẦN NHẤT phía dưới `from`. TP1 phải gần — không nhảy thẳng tới POC ở tận đáy. */
function stepBelow(levels: number[], from: number, gap: number): number | null {
  const c = levels.filter((x) => x <= from - gap);
  return c.length ? Math.max(...c) : null;
}

function stepAbove(levels: number[], from: number, gap: number): number | null {
  const c = levels.filter((x) => x >= from + gap);
  return c.length ? Math.min(...c) : null;
}

export function buildShortLevels(inp: DecideInput): Levels {
  const { vp, pa, candles, last } = inp;
  const buffer = Math.max(inp.pa.atr * 0.3, vp.binSize);
  const gap = Math.max(inp.pa.atr * 0.5, vp.binSize * 3);
  const nodeAbove = nextHVN(vp, last, 1);

  // Entry ở MÉP. Ba trường hợp, không trường hợp nào đặt entry xa giá một cách vô lý:
  //  - có HVN phía trên   → bám hai biên của node đó
  //  - VAH còn ở trên giá → bám VAH
  //  - giá đã ở TRÊN value → mép là chính vùng đỉnh vừa tạo, không phải VAH ở dưới
  let e1: number;
  let e2: number;
  if (nodeAbove) {
    e1 = nodeAbove.low; e2 = nodeAbove.high;
  } else if (vp.va70.high > last) {
    e1 = vp.va70.high; e2 = vp.va70.high + buffer;
  } else {
    e1 = last; e2 = Math.max(pa.range.high, last + buffer);
  }
  const entry: [number, number] = [Math.min(e1, e2), Math.max(e1, e2)];

  // SL = mức THESIS CHẾT: ngay trên cụm wick ở mép entry + buffer.
  // Neo vào biên vùng entry, KHÔNG neo vào đỉnh range 20 nến — đỉnh range có thể
  // cách rất xa và khi đó stop bị nới ra "cho khỏi bị quét", đúng lỗi bị cấm.
  // Túi equal-high sát trên phải nằm trong stop, vì đó là chỗ giá hay bị kéo tới.
  const wick = wickCluster(candles, entry[1], 'above');
  const eqAbove = pa.equalHighs
    .filter((p) => p > entry[1] && p <= entry[1] * 1.01)
    .sort((a, b) => a - b)[0];
  const sl = Math.max(wick, eqAbove ?? 0, entry[1]) + buffer;

  // TP1: bậc value GẦN NHẤT dưới entry. Luôn trong VA vì danh sách chỉ chứa mốc trong VA.
  const refs = vaReferences(vp);
  let tp1 = stepBelow(refs, entry[0], gap);
  if (tp1 == null) tp1 = Math.min(vp.va70.low, entry[0] - gap);
  const tp1InVA = tp1 >= vp.va70.low && tp1 <= vp.va70.high;

  // TP2: bậc kế tiếp sau TP1 — mốc value tiếp theo, biên HVN dưới, hoặc sàn range.
  const nodeBelow = nextHVN(vp, tp1, -1);
  const nextRef = stepBelow(refs, tp1, gap);
  const cands = [nextRef, nodeBelow ? nodeBelow.high : null].filter((x): x is number => x != null);
  let tp2 = cands.length ? Math.max(...cands) : Math.min(vp.va70.low, pa.range.low);
  if (tp2 >= tp1) tp2 = Math.min(vp.va70.low, pa.range.low, tp1 - vp.binSize);

  // Cấm TP xuyên 3–4 HVN trên full size. Đo trên ĐOẠN SAU TP1 — phần mà 30% cuối
  // còn phải đi — rồi kéo TP2 về đúng bậc kế tiếp. Không bao giờ kéo TP2 về sau TP1.
  let crossings = hvnCrossings(vp, tp1, tp2);
  if (crossings >= 3 && nodeBelow) {
    tp2 = nodeBelow.high;
    crossings = hvnCrossings(vp, tp1, tp2);
  }

  const runner = inp.htf?.rangeLow != null
    ? `chỉ mở sau khi ${TRIGGER_TF[inp.htf.tf ?? inp.tf]} đóng < ${fmtPrice(inp.htf.rangeLow, vp.binSize)} (sàn range HTF)`
    : null;

  return { entry, sl, tp1, tp2, runner, tp1InVA, crossings };
}

export function buildLongLevels(inp: DecideInput): Levels {
  const { vp, pa, candles, last } = inp;
  const buffer = Math.max(inp.pa.atr * 0.3, vp.binSize);
  const gap = Math.max(inp.pa.atr * 0.5, vp.binSize * 3);
  const nodeBelow = nextHVN(vp, last, -1);

  let e1: number;
  let e2: number;
  if (nodeBelow) {
    e1 = nodeBelow.high; e2 = nodeBelow.low;
  } else if (vp.va70.low < last) {
    e1 = vp.va70.low; e2 = vp.va70.low - buffer;
  } else {
    e1 = last; e2 = Math.min(pa.range.low, last - buffer);
  }
  const entry: [number, number] = [Math.min(e1, e2), Math.max(e1, e2)];

  const wick = wickCluster(candles, entry[0], 'below');
  const eqBelow = pa.equalLows
    .filter((p) => p < entry[0] && p >= entry[0] * 0.99)
    .sort((a, b) => b - a)[0];
  const sl = Math.min(wick, eqBelow ?? Infinity, entry[0]) - buffer;

  const refs = vaReferences(vp);
  let tp1 = stepAbove(refs, entry[1], gap);
  if (tp1 == null) tp1 = Math.max(vp.va70.high, entry[1] + gap);
  const tp1InVA = tp1 >= vp.va70.low && tp1 <= vp.va70.high;

  const nodeAbove = nextHVN(vp, tp1, 1);
  const nextRef = stepAbove(refs, tp1, gap);
  const cands = [nextRef, nodeAbove ? nodeAbove.low : null].filter((x): x is number => x != null);
  let tp2 = cands.length ? Math.min(...cands) : Math.max(vp.va70.high, pa.range.high);
  if (tp2 <= tp1) tp2 = Math.max(vp.va70.high, pa.range.high, tp1 + vp.binSize);

  let crossings = hvnCrossings(vp, tp1, tp2);
  if (crossings >= 3 && nodeAbove) {
    tp2 = nodeAbove.low;
    crossings = hvnCrossings(vp, tp1, tp2);
  }

  const runner = inp.htf?.rangeHigh != null
    ? `chỉ mở sau khi ${TRIGGER_TF[inp.htf.tf ?? inp.tf]} đóng > ${fmtPrice(inp.htf.rangeHigh, vp.binSize)} (trần range HTF)`
    : null;

  return { entry, sl, tp1, tp2, runner, tp1InVA, crossings };
}

export function rr(entry: number, sl: number, tp: number): number | null {
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return null;
  return Math.abs(tp - entry) / risk;
}

// ------------------------------------------------------------
// 4. Confluence 0–10
// ------------------------------------------------------------

export function scoreConfluence(
  inp: DecideInput,
  side: 'LONG' | 'SHORT',
  stage: Stage,
  lv: Levels | null,
  rr1: number | null,
): Confluence {
  const lines: ScoreLine[] = [];
  const { pa, vp, deriv, delta, last } = inp;

  // --- Cộng ---
  const atEdge = stage === 'edge-fail' || stage === 'edge-hold' ||
    stage === 'breakdown' || stage === 'breakout';
  if (atEdge) lines.push({ label: `PA ở mép (${stage})`, points: 2 });

  const edgeRef = side === 'SHORT' ? vp.va70.high : vp.va70.low;
  if (near(last, edgeRef, NEAR * 2.5) || stage === 'breakdown' || stage === 'breakout') {
    lines.push({ label: `VP: giá ở mép value (${side === 'SHORT' ? 'VAH' : 'VAL'})`, points: 2 });
  }

  const closedBar = inp.candles.filter((c) => c.closed).slice(-1)[0];
  if (closedBar) {
    const confirmed = side === 'SHORT' ? closedBar.c < closedBar.o : closedBar.c > closedBar.o;
    const sigOk = side === 'SHORT'
      ? pa.signal === 'pin-bear' || pa.signal === 'engulf-bear'
      : pa.signal === 'pin-bull' || pa.signal === 'engulf-bull';
    if (confirmed && pa.signalHasVolume) {
      lines.push({ label: 'Nến đóng xác nhận + volume ≥ median 20', points: sigOk ? 2 : 1.5 });
    } else if (confirmed) {
      lines.push({ label: 'Nến đóng xác nhận nhưng volume dưới median', points: 0.5 });
    }
  }

  // OI đồng hướng — chỉ khi đọc được
  if (deriv.oi.quality === 'REAL' && deriv.oi.read !== 'na' && deriv.oi.read !== 'flat') {
    const bearish = deriv.oi.read === 'new-shorts' || deriv.oi.read === 'long-cover';
    const bullish = deriv.oi.read === 'new-longs' || deriv.oi.read === 'short-cover';
    if ((side === 'SHORT' && bearish) || (side === 'LONG' && bullish)) {
      lines.push({ label: `OI đồng hướng: ${OI_READ_VI[deriv.oi.read]}`, points: 1.5 });
    }
  }

  // Funding CHỈ tính khi extreme. Phẳng = 0 điểm, không được là lý do.
  if (deriv.funding.quality === 'REAL' && deriv.funding.extreme) {
    const r = deriv.funding.rate!;
    if ((side === 'SHORT' && r > 0) || (side === 'LONG' && r < 0)) {
      lines.push({ label: `Funding extreme ngược đám đông (${(r * 100).toFixed(4)}%/8h)`, points: 1 });
    }
  }

  // Divergence delta
  if (delta.quality !== 'UNAVAILABLE') {
    if (side === 'LONG' && delta.divergence === 'regular-bull') {
      lines.push({ label: `Divergence bullish (${delta.quality})`, points: 1 });
    }
    if (side === 'SHORT' && delta.divergence === 'regular-bear') {
      lines.push({ label: `Divergence bearish (${delta.quality})`, points: 1 });
    }
  }

  // --- Trừ ---
  if (inMidValue(vp, last)) lines.push({ label: 'Giá đứng GIỮA value area — cấm vào', points: -4 });
  if (pa.volMedian20 > 0 && pa.lastVol < pa.volMedian20 * 0.6) {
    lines.push({ label: 'Volume teo (< 60% median 20)', points: -1.5 });
  }
  if (rr1 != null && rr1 < MIN_RR1) {
    lines.push({ label: `RR TP1 = ${rr1.toFixed(2)} < ${MIN_RR1}`, points: -2 });
  }
  if (lv) {
    const slPct = (Math.abs(lv.entry[side === 'SHORT' ? 0 : 1] - lv.sl) / last) * 100;
    if (slPct > SL_WIDE_PCT) {
      lines.push({ label: `SL phải rộng ${slPct.toFixed(2)}% giá`, points: -1.5 });
    }
  }
  if (inp.htf) {
    const against =
      (side === 'SHORT' && (inp.htf.bias === 'LONG' || inp.htf.trendUp)) ||
      (side === 'LONG' && (inp.htf.bias === 'SHORT' || inp.htf.trendDown));
    if (against) lines.push({ label: `TF lớn (${inp.htf.tf}) ngược hướng`, points: -1.5 });
  }

  const raw = lines.reduce((s, l) => s + l.points, 0);
  return { score: Math.max(0, Math.min(10, raw)), raw, lines };
}

// ------------------------------------------------------------
// 5. decideBias
// ------------------------------------------------------------

export function decideBias(inp: DecideInput): Recommendation {
  const { vp, pa, last, tf, symbol } = inp;
  const bs = vp.binSize;
  const P = (x: number | null) => fmtPrice(x, bs);
  const stage = classifyStage(vp, pa, last);
  const warnings: string[] = [];

  // Ứng viên hướng theo stage. mid-range → không có ứng viên nào.
  let side: 'LONG' | 'SHORT' | null = null;
  if (stage === 'edge-fail' || stage === 'breakdown') side = 'SHORT';
  else if (stage === 'edge-hold' || stage === 'breakout') side = 'LONG';

  const gate: Gate = side === 'SHORT' ? shortGate(inp, stage)
    : side === 'LONG' ? longGate(inp, stage)
    : { pass: false, why: 'giá nằm giữa value — không có mép để bám' };

  const lv = side === 'SHORT' ? buildShortLevels(inp)
    : side === 'LONG' ? buildLongLevels(inp)
    : null;

  const entryRef = lv ? (side === 'SHORT' ? lv.entry[0] : lv.entry[1]) : null;
  const rr1 = lv && entryRef != null ? rr(entryRef, lv.sl, lv.tp1) : null;
  const rr2 = lv && entryRef != null ? rr(entryRef, lv.sl, lv.tp2) : null;

  const conf = side
    ? scoreConfluence(inp, side, stage, lv, rr1)
    : {
        score: 0, raw: 0,
        lines: [{ label: 'Giá đứng GIỮA value area — cấm vào', points: -4 }] as ScoreLine[],
      };

  // Quyết định cuối: ≥7 mới ra lệnh, và cổng TF phải mở.
  let bias: Bias = 'WAIT';
  if (side && gate.pass && conf.score >= 7) bias = side;

  // ---- Cảnh báo đỏ ----
  if (lv) {
    if (inMidValue(vp, (lv.entry[0] + lv.entry[1]) / 2)) {
      warnings.push('Entry rơi vào GIỮA value area — không vào market ở đây.');
    }
    if (rr1 != null && rr1 < 1) warnings.push(`RR TP1 = ${rr1.toFixed(2)} < 1 — kèo lỗ kỳ vọng.`);
    const slPct = (Math.abs(entryRef! - lv.sl) / last) * 100;
    if (slPct > SL_WIDE_PCT) {
      warnings.push(`SL cách entry ${slPct.toFixed(2)}% — trên isolated đòn bẩy cao là cháy.`);
    }
    if (!lv.tp1InVA) warnings.push('TP1 rơi ngoài VA — đã kéo về mép value gần nhất.');
    if (lv.crossings >= 3) {
      warnings.push(`Đoạn TP1→TP2 vẫn xuyên ${lv.crossings} HVN — phần 30% này chạy như runner, không full size.`);
    }
  }
  if (inp.deriv.oi.squeezeWarning) {
    warnings.push('OI/vol24h cao bất thường — rủi ro squeeze hai chiều. Không vào vì "OI cao".');
  }

  // ---- Counter-trend ----
  const counterTrend = !!(
    bias !== 'WAIT' && inp.htf &&
    ((bias === 'SHORT' && (inp.htf.bias === 'LONG' || inp.htf.trendUp)) ||
     (bias === 'LONG' && (inp.htf.bias === 'SHORT' || inp.htf.trendDown)))
  );
  const size: SizeHint = counterTrend || conf.score < 8 ? 'Small' : 'Normal';

  // ---- Lý do 3–6 gạch ----
  const reasons = buildReasons(inp, stage, side, conf, gate, counterTrend);

  // ---- Trigger / Invalidation ----
  const trigTf = TRIGGER_TF[tf];
  const trigger = side === 'SHORT' && lv
    ? `${trigTf} đóng dưới ${P(Math.min(vp.va70.high, lv.entry[0]))} sau khi test ${P(lv.entry[1])}`
    : side === 'LONG' && lv
      ? `${trigTf} đóng trên ${P(Math.max(vp.va70.low, lv.entry[1]))} sau khi giữ ${P(lv.entry[0])}`
      : `chờ giá rời lõi VA (${P(vp.va70.low)}–${P(vp.va70.high)}) và về một trong hai mép`;

  const invalidation = side === 'SHORT' && lv
    ? `đóng nến ${trigTf} trên ${P(lv.sl)} thì hủy — thị trường chấp nhận giá trên cụm HVN, luận điểm chết`
    : side === 'LONG' && lv
      ? `đóng nến ${trigTf} dưới ${P(lv.sl)} thì hủy — mất mép value, luận điểm chết`
      : `hủy trạng thái chờ khi ${trigTf} đóng ngoài ${P(vp.va70.low)}–${P(vp.va70.high)} (khi đó đọc lại theo mép mới)`;

  const rec: Recommendation = {
    symbol, tf, bias, stage,
    entry: lv ? lv.entry : null,
    trigger,
    sl: lv ? lv.sl : null,
    tp1: lv ? lv.tp1 : null,
    tp2: lv ? lv.tp2 : null,
    runner: lv ? lv.runner : null,
    rr1, rr2, size, invalidation, reasons,
    confidence: Math.max(1, Math.min(10, Math.round(conf.score))),
    confluence: conf,
    warnings,
    counterTrend,
    vp: {
      poc: vp.poc, vaLow: vp.va70.low, vaHigh: vp.va70.high, last,
      binSize: bs,
      hvn: vp.hvn.slice(0, 5).map((n) => n.price).sort((a, b) => a - b),
      lvn: vp.lvn.slice(0, 5).map((n) => n.price).sort((a, b) => a - b),
    },
    rangePos: pa.rangePos,
    planText: '',
  };
  rec.planText = buildPlanText(rec);
  return rec;
}

// ------------------------------------------------------------
// Lý do — chỉ nói điều đo được. N/A không bao giờ thành lý do.
// ------------------------------------------------------------

function buildReasons(
  inp: DecideInput,
  stage: Stage,
  side: 'LONG' | 'SHORT' | null,
  conf: Confluence,
  gate: Gate,
  counterTrend: boolean,
): string[] {
  const { vp, pa, deriv, delta, last, tf } = inp;
  const P = (x: number) => fmtPrice(x, vp.binSize);
  const out: string[] = [];

  // PA
  // "mid-range" trong hệ này nghĩa là KHÔNG CÓ MÉP, và có hai lý do khác nhau:
  // đứng giữa value, hoặc đã rời hẳn value. Nói đúng cái nào là cái nào.
  const outAtr = pa.atr > 0
    ? (last > vp.va70.high ? (last - vp.va70.high) / pa.atr
      : last < vp.va70.low ? (vp.va70.low - last) / pa.atr : 0)
    : 0;
  const noEdge = outAtr > 1.2
    ? `giá ${P(last)} đã rời hẳn ${last > vp.va70.high ? 'lên trên' : 'xuống dưới'} value ` +
      `${P(vp.va70.low)}–${P(vp.va70.high)} (cách mép ${outAtr.toFixed(1)} ATR) — ` +
      'profile của khung này không còn mép nào để bám, mọi TP đều phải xuyên nhiều HVN'
    : `đứng giữa value ${P(vp.va70.low)}–${P(vp.va70.high)}, POC ${P(vp.poc)}`;

  const stageVi: Record<Stage, string> = {
    'edge-fail': `fail mép trên: chạm ${P(vp.va70.high)} rồi đóng lại trong value`,
    'edge-hold': `giữ mép dưới: về ${P(vp.va70.low)} và chưa đóng thủng`,
    breakdown: `đóng thủng VAL ${P(vp.va70.low)} — thị trường chấp nhận giá dưới`,
    breakout: `đóng vượt VAH ${P(vp.va70.high)} — thị trường chấp nhận giá trên`,
    'mid-range': noEdge,
  };
  out.push(`PA: ${stageVi[stage]}; vị trí close trong range 20 nến ${pa.rangePos.toFixed(0)}%.`);

  if (pa.grab) {
    out.push(`PA: wick ${pa.grab === 'up' ? 'lên' : 'xuống'} ra ngoài range rồi đóng trong = grab thanh khoản, KHÔNG phải break.`);
  } else if (pa.acceptedOutside) {
    out.push(`PA: close giữ ngoài range phía ${pa.acceptedOutside === 'up' ? 'trên' : 'dưới'} = accept.`);
  }
  if (pa.structure !== 'NONE') {
    const vi: Record<string, string> = {
      BOS_UP: 'BOS lên (đóng thủng swing high theo xu hướng)',
      BOS_DOWN: 'BOS xuống (đóng thủng swing low theo xu hướng)',
      CHOCH_UP: 'CHOCH lên (đóng ngược cấu trúc giảm)',
      CHOCH_DOWN: 'CHOCH xuống (đóng ngược cấu trúc tăng)',
    };
    out.push(`PA: ${vi[pa.structure]}.`);
  }

  // VP
  out.push(
    `VP ${tf}: POC ${P(vp.poc)} · VA70 ${P(vp.va70.low)}–${P(vp.va70.high)} · ` +
    `${vp.hvn.length} HVN, ${vp.lvn.length} LVN (mode ${vp.mode}, bin ${vp.binSize}).`,
  );
  if (side === 'SHORT' && pa.equalHighs.length) {
    out.push(`VP/PA: có equal highs quanh ${P(pa.equalHighs[pa.equalHighs.length - 1])} — túi SL, stop phải nằm ngoài chúng.`);
  }
  if (side === 'LONG' && pa.equalLows.length) {
    out.push(`VP/PA: có equal lows quanh ${P(pa.equalLows[0])} — túi SL, stop phải nằm ngoài chúng.`);
  }

  // OI / funding — chỉ khi đọc được
  if (deriv.oi.quality === 'REAL' && deriv.oi.read !== 'na' && deriv.oi.read !== 'flat') {
    out.push(`OI: ${OI_READ_VI[deriv.oi.read]} (${deriv.oi.venue}, ${deriv.oi.note}).`);
  } else if (deriv.oi.quality === 'UNAVAILABLE') {
    out.push('OI: N/A — không dùng làm lý do.');
  }
  if (deriv.funding.quality === 'REAL' && !deriv.funding.flat) {
    out.push(`Funding: ${deriv.funding.note}`);
  }

  // Delta
  if (delta.divergence !== 'none') {
    out.push(
      `Delta: ${delta.divergence === 'regular-bull' ? 'regular bullish (giá LL, CVD HL)' : 'regular bearish (giá HH, CVD LH)'} ` +
      `— ${delta.quality === 'REAL' ? 'taker thật, chợ SPOT' : 'PROXY từ hướng đóng nến'}.`,
    );
  }

  // Vì sao WAIT
  if (!gate.pass) out.push(`Chưa đủ điều kiện phát lệnh: ${gate.why}.`);
  else if (conf.score < 7) out.push(`Score ${conf.score.toFixed(1)}/10 < 7 — chưa đủ hợp lưu, WAIT.`);
  if (counterTrend) out.push('Counter-trend so với TF lớn: size Small, TP1 bắt buộc chốt.');

  return out.slice(0, 6).length >= 3 ? out.slice(0, 6) : out;
}

// ------------------------------------------------------------
// Text plan (§6)
// ------------------------------------------------------------

export function buildPlanText(r: Recommendation): string {
  const bs = r.vp.binSize;
  const P = (x: number | null) => fmtPrice(x, bs);
  const L: string[] = [];

  L.push(`[${r.symbol}] [${r.tf}] [${r.bias}] score ${r.confluence.score.toFixed(1)}/10`);
  L.push(`Entry: ${r.entry ? `${P(r.entry[0])} – ${P(r.entry[1])}` : 'không đặt — chưa có mép để bám'}`);
  L.push(`Trigger đóng: ${r.trigger}`);
  L.push(`SL: ${P(r.sl)}${r.sl != null ? ` (thesis chết khi ${r.bias === 'LONG' ? 'đóng dưới' : 'đóng trên'} mức này)` : ''}`);
  L.push(`TP1: ${P(r.tp1)} gỡ 50%${r.rr1 != null ? ` · RR ${r.rr1.toFixed(2)}` : ''}`);
  L.push(`TP2: ${P(r.tp2)} gỡ 30%${r.rr2 != null ? ` · RR ${r.rr2.toFixed(2)}` : ''}`);
  L.push(`Runner: ${r.runner ?? 'không mở — chưa có mốc đóng thủng HTF'}`);
  L.push(`Hủy: ${r.invalidation}`);
  L.push(`Size: ${r.size}${r.counterTrend ? ' (counter-trend — bắt buộc chốt TP1)' : ''} · rủi ro 0.5–1% tài khoản`);
  L.push('Lý do:');
  for (const x of r.reasons) L.push(`  - ${x}`);
  if (r.warnings.length) {
    L.push('Cảnh báo:');
    for (const w of r.warnings) L.push(`  ! ${w}`);
  }
  L.push('Cấm: market giữa VA, TP xuyên nhiều HVN, add sau lỗ.');
  return L.join('\n');
}
