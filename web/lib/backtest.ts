import { prepareTF } from './analyze';
import { decideDirection, type Conviction, type DirectionalCall, type Weights } from './direct';
import { buildFlow } from './flow';
import type { MinuteFeed } from './minute';
import type { Candle, Derivatives, TF } from './types';

// ============================================================
// Backtest: phát lại lịch sử từng nến, mỗi nến hỏi engine "bây giờ vào bên nào",
// rồi đi tiếp để xem lệnh đó sống chết ra sao.
//
// BA NGUYÊN TẮC, phá cái nào là kết quả thành rác:
//
// 1. KHÔNG NHÌN TRỘM TƯƠNG LAI. Tín hiệu ở nến i chỉ được thấy nến 0..i. Cửa sổ
//    profile cũng phải bằng đúng cửa sổ live, nếu không thì đang kiểm chứng một
//    hệ khác với hệ đang chạy.
// 2. CÙNG MỘT CODE QUYẾT ĐỊNH. Đi qua prepareTF + decideDirection y như live.
// 3. NGHI NGỜ THÌ CHỌN PHÍA XẤU. Trong một nến mà giá chạm cả SL lẫn TP, dữ liệu
//    nến không nói được cái nào trước — luôn tính là SL trước.
// ============================================================

/** Cửa sổ profile của từng TF — phải khớp LIMIT trong scan.ts. */
export const BT_WINDOW: Record<TF, number> = { '15m': 192, '1h': 168, '4h': 126, '1d': 90 };

export interface BTOptions {
  /**
   * Phí mỗi chiều, tính theo notional (0.0005 = 0.05%, mức taker perp Binance).
   * Bỏ qua phí là tự thổi phồng kết quả: với stop rộng 1% giá thì một vòng
   * vào-ra đã ăn mất khoảng 0.1R, tức nửa cái edge đang đo được.
   */
  feeRate: number;
  /** Trượt giá thêm khi thoát bằng stop — lệnh stop ăn giá thị trường, không phải giá mình muốn. */
  slipRate: number;
  /** Số nến chờ giá chạm vùng entry. Quá hạn thì bỏ kèo, không tính là lệnh. */
  entryWindow: number;
  /** Tối đa giữ lệnh bao nhiêu nến trước khi đóng theo giá thị trường. */
  maxHold: number;
  /** Chỉ nhận tín hiệu từ hạng này trở lên. */
  minConviction: Conviction;
  /** Không mở lệnh mới khi đang có lệnh chạy — giống người thật. */
  onePositionAtATime: boolean;
  /**
   * Sau khi chạm TP1 thì dời stop của phần còn lại về giá vào lệnh.
   * Chỉ có hiệu lực TỪ NẾN SAU nến chạm TP1 — trong cùng một nến ta không biết
   * thứ tự nên vẫn tính stop gốc, tức là luôn chọn phía xấu cho mình.
   */
  breakevenAfterTP1: boolean;
  /** Bỏ tín hiệu có |net| dưới ngưỡng này. null = không lọc. */
  minNet: number | null;
  /** Bỏ tín hiệu có tỷ lệ lời/lỗ kế hoạch trên ngưỡng này. null = không lọc. */
  maxRewardRatio: number | null;
  /** Bỏ tín hiệu có kỳ vọng sau phí dưới ngưỡng này (R). null = không lọc. */
  minExpectancy: number | null;
  /** Bộ trọng số chấm điểm. null = dùng bộ đang chạy thật. */
  weights: Weights | null;
  /** Cắt profile tại điểm value dời chỗ. */
  valueMigration: boolean;
  /** Thu cửa sổ profile khi VA rộng quá bấy nhiêu lần ATR. null = không thu. */
  maxVAoverATR: number | null;
  /** Bỏ tín hiệu có SL cách entry quá bấy nhiêu % giá. null = không lọc. */
  maxSLPct: number | null;
  /** Bỏ tín hiệu có SL SÁT entry hơn bấy nhiêu % giá. null = không lọc. */
  minSLPct: number | null;
  /** Bỏ tín hiệu có vùng entry cách giá hiện tại quá bấy nhiêu % . null = không lọc. */
  maxEntryDistPct: number | null;
}

export const DEFAULT_BT: BTOptions = {
  feeRate: 0.0005,
  slipRate: 0.0002,
  entryWindow: 12,
  maxHold: 60,
  minConviction: 'C',
  onePositionAtATime: true,
  breakevenAfterTP1: false,
  minNet: null,
  maxRewardRatio: null,
  minExpectancy: null,
  weights: null,
  valueMigration: true,
  maxVAoverATR: null,
  maxSLPct: null,
  minSLPct: null,
  maxEntryDistPct: null,
};

const RANK: Record<Conviction, number> = { C: 0, B: 1, A: 2, GOLD: 3 };

export type ExitReason = 'tp2' | 'tp1-then-sl' | 'tp1-then-be' | 'tp1-then-timeout' | 'sl' | 'timeout';

export interface Trade {
  symbol: string;
  tf: TF;
  side: 'LONG' | 'SHORT';
  conviction: Conviction;
  golden: boolean;
  net: number;
  signalIdx: number;
  signalTime: number;
  entryIdx: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  exitIdx: number;
  exitReason: ExitReason;
  hitTP1: boolean;
  hitTP2: boolean;
  /** R thực hiện SAU phí và trượt giá. Đây mới là con số đáng nhìn. */
  r: number;
  /** R trước khi trừ phí — giữ lại để thấy phí ăn mất bao nhiêu. */
  rGross: number;
  /** Chi phí quy ra R. */
  costR: number;
  /** Bằng chứng lúc phát tín hiệu — để đo vế nào thật sự có edge. */
  evidence: { label: string; points: number }[];
  /** Để hiệu chuẩn ngưỡng hạng vàng bằng dữ liệu thay vì bằng cảm tính. */
  warningCount: number;
  /** Tỷ lệ lời/lỗ của KẾ HOẠCH (0.5×RR1 + 0.5×RR2) — không phải kỳ vọng. */
  rewardRatio: number | null;
  /** Kỳ vọng SAU PHÍ, có xác suất chạm đo được. Đây mới là con số so được. */
  expectancyR: number | null;
  /** Xác suất kết thúc có lãi, theo bảng tỉ lệ chạm. */
  pWin: number | null;
  /** Khoảng cách TP1/TP2 tính theo R — đơn vị không phụ thuộc giá, dùng để đo
   *  tỉ lệ chạm theo ĐỘ XA thay vì chỉ theo hạng. */
  rr1: number | null;
  rr2: number | null;
  /** Khoảng cách entry→SL tính theo % giá. Stop rộng = phí nặng theo R và kèo tồi. */
  slPct: number;
  /** Vùng entry cách giá lúc ra tín hiệu bao nhiêu % — entry quá xa là mức giá rác. */
  entryDistPct: number;
  unanimous: boolean;
  /** Tín hiệu có qua cửa chất lượng không. */
  tradeable: boolean;
  /**
   * Thứ tự chạm trong nến được GỠ bằng nến 1m, hay chỉ là giả định thận trọng.
   * false nghĩa là kết quả lệnh này vẫn còn phụ thuộc vào một giả định.
   */
  intrabarResolved: boolean;

}

export interface BTStats {
  trades: number;
  wins: number;
  winRate: number;
  totalR: number;
  avgR: number;
  /** Tổng lãi chia tổng lỗ. < 1 là hệ thua. */
  profitFactor: number;
  maxDrawdownR: number;
  tp1Rate: number;
  tp2Rate: number;
}

/** Phái sinh rỗng — backtest từ sandbox không có OI/funding/taker perp lịch sử. */
export function blindDerivatives(): Derivatives {
  return {
    funding: {
      quality: 'UNAVAILABLE', venue: null, rate: null, nextFundingTime: null,
      markPrice: null, flat: false, extreme: false, history: null, note: 'N/A — backtest mù phái sinh.',
    },
    oi: {
      quality: 'UNAVAILABLE', venue: null, open: null, unit: null, chg1h: null, chg24h: null,
      read: 'na', squeezeWarning: false, oiOverVol: null, note: 'N/A — backtest mù phái sinh.',
    },
    perpTaker: {
      quality: 'UNAVAILABLE', venue: null, lastBar: null, cvd: null, cvdSeries: [],
      deltaAtPrice: [], divergence: 'none', note: 'N/A — backtest mù phái sinh.',
    },
  };
}

/** Cắt lát lịch sử và đánh dấu mọi nến là ĐÃ ĐÓNG — đúng trạng thái lúc nến i vừa chốt. */
function sliceAsOf(candles: Candle[], i: number, window: number): Candle[] {
  const from = Math.max(0, i - window + 1);
  return candles.slice(from, i + 1).map((c) => (c.closed ? c : { ...c, closed: true }));
}

/** Tín hiệu tại nến i, chỉ nhìn 0..i. Trả null khi không đủ dữ liệu. */
export function signalAt(
  symbol: string,
  tf: TF,
  candles: Candle[],
  i: number,
  window = BT_WINDOW[tf],
  weights: Weights | null = null,
  valueMigration = true,
  maxVAoverATR: number | null = null,
): DirectionalCall | null {
  const slice = sliceAsOf(candles, i, window);
  const deriv = blindDerivatives();
  const prepared = prepareTF({
    symbol, tf, candles: slice, deriv, htf: null, hasClosedBar: true,
    valueMigration, maxVAoverATR,
  });
  if (!prepared) return null;
  const flow = buildFlow(null, slice, { retailLongPct: null, topLongPct: null }, deriv.funding);
  return decideDirection(prepared.input, prepared.structure, flow, weights ?? undefined);
}

export type FillResult =
  /** Giá in ra đúng mức chờ trong nến `idx`. */
  | { kind: 'filled'; idx: number }
  /** Nến nhảy hẳn qua mức chờ ở nến `idx` — mức đó không được giao dịch. */
  | { kind: 'gapped'; idx: number }
  /** Hết cửa sổ chờ mà giá không tới. */
  | { kind: 'never' };

/**
 * Tìm nến khớp lệnh chờ, tách riêng để test soi được từng trường hợp.
 *
 * Quét từ nến SAU nến ra tín hiệu — nến ra tín hiệu đã đóng khi ta quyết định,
 * không thể khớp lùi vào trong nó.
 */
export function findFill(
  candles: Candle[],
  from: number,
  entry: number,
  long: boolean,
  entryWindow: number,
): FillResult {
  const last = Math.min(from + entryWindow, candles.length - 1);
  for (let j = from + 1; j <= last; j++) {
    const b = candles[j];
    if (entry >= b.l && entry <= b.h) return { kind: 'filled', idx: j };
    // Nến nằm trọn ở phía lệnh chờ muốn tới: giá đã vượt mức mà không in ra nó.
    if (long ? b.h < entry : b.l > entry) return { kind: 'gapped', idx: j };
  }
  return { kind: 'never' };
}

export interface SimContext {
  /**
   * Nến 1 phút để GỠ THỨ TỰ TRONG NẾN. Không có thì mọi thứ quay về giả định
   * thận trọng — và phải quay về đúng như thế, chứ không được coi "không có dữ
   * liệu" là "không có gì xảy ra".
   */
  minutes?: MinuteFeed;
  /** Độ dài một nến, ms. Cần để biết nến kết thúc ở đâu khi tra nến 1m. */
  tfMs?: number;
}

/**
 * Các bước đi bên trong một nến.
 *
 * Có nến 1m thì trả về từng phút; không có thì trả về chính cây nến đó, tức là
 * một bước duy nhất — và khi đó cửa sổ mù rộng đúng bằng một nến.
 */
function stepsOf(candles: Candle[], j: number, ctx?: SimContext): { steps: Candle[]; resolved: boolean } {
  if (ctx?.minutes && ctx.tfMs) {
    const m = ctx.minutes(candles[j].t, candles[j].t + ctx.tfMs);
    if (m && m.length) return { steps: m, resolved: true };
  }
  return { steps: [candles[j]], resolved: false };
}

/**
 * Mô phỏng một lệnh từ tín hiệu ở nến `from`.
 *
 * Entry là lệnh chờ ở MÉP GẦN NHẤT của vùng: long chờ giá xuống nên khớp ở mép
 * trên, short chờ giá lên nên khớp ở mép dưới. Đó cũng là mép xấu hơn cho người
 * vào lệnh, đúng tinh thần nghi ngờ thì chọn phía xấu.
 *
 * NGHI NGỜ THÌ CHỌN PHÍA XẤU, ÁP Ở BƯỚC NHỎ NHẤT CÓ DỮ LIỆU. Trong một bước ta
 * không biết giá đi theo thứ tự nào, nên: stop tính ngay từ bước khớp lệnh, còn
 * chốt lời chỉ tính từ bước SAU đó. Đưa nến 1m vào thì quy tắc không đổi, chỉ là
 * cửa sổ mù thu từ một nến xuống một phút — đó là chỗ khác nhau giữa một giả
 * định và một số đo.
 */
export function simulate(
  candles: Candle[],
  from: number,
  call: DirectionalCall,
  opt: BTOptions,
  ctx?: SimContext,
): Trade | null {
  const long = call.side === 'LONG';
  const entry = long ? call.entry[1] : call.entry[0];
  const risk = Math.abs(entry - call.sl);
  if (!(risk > 0)) return null;

  // Chi phí quy ra R. Vào một lần, ra một lần (gộp các lần chốt), cộng trượt giá
  // nếu thoát bằng stop. Stop càng hẹp thì phí càng nặng tính theo R — đó là lý do
  // một hệ nhìn có edge trên giấy vẫn có thể lỗ khi chạy thật.
  const feeR = (opt.feeRate * 2 * entry) / risk;
  const slipR = (opt.slipRate * entry) / risk;
  const lastBar = candles.length - 1;

  // ---- 1. Chờ khớp ----
  //
  // Lệnh chờ chỉ khớp khi giá THẬT SỰ in ra mức đó — tức entry nằm trong
  // [low, high] của bước đang xét. Nếu giá nhảy hẳn qua mức chờ thì mức đó không
  // hề được giao dịch; ghi một lệnh khớp ở đúng giá entry là bịa ra một mức giá
  // thị trường chưa bao giờ đưa ra.
  //
  // Nhảy qua thì bỏ kèo, không phải một lệnh: giá vào thật lúc đó là giá mở
  // bước, khác hẳn kế hoạch, nên khoảng cách entry→SL — đơn vị R của cả lệnh —
  // không còn là cái đã chấm điểm.
  let entryIdx = -1;
  let entryStep = -1;
  let anyResolved = false;

  fill: for (let j = from + 1; j <= Math.min(from + opt.entryWindow, lastBar); j++) {
    const { steps, resolved } = stepsOf(candles, j, ctx);
    anyResolved = anyResolved || resolved;
    for (let k = 0; k < steps.length; k++) {
      const b = steps[k];
      if (entry >= b.l && entry <= b.h) { entryIdx = j; entryStep = k; break fill; }
      if (long ? b.h < entry : b.l > entry) return null;   // nhảy qua
    }
  }
  if (entryIdx < 0) return null;

  // ---- 2. Đi tiếp ----
  let hitTP1 = false;
  let hitTP2 = false;
  let exitIdx = Math.min(entryIdx + opt.maxHold, lastBar);
  let exitReason: ExitReason = 'timeout';
  let r = 0;
  let resolvedExit = false;

  const R = (price: number) => (long ? price - entry : entry - price) / risk;

  // Mốc "đã chạm TP1" tính bằng số thứ tự bước toàn cục, để quy tắc dời stop về
  // hoà vốn cũng chỉ có hiệu lực từ bước SAU bước chạm — cùng một lý do.
  let tp1Step = -1;
  let stepNo = 0;

  for (let j = entryIdx; j <= Math.min(entryIdx + opt.maxHold, lastBar); j++) {
    const { steps, resolved } = stepsOf(candles, j, ctx);
    for (let k = 0; k < steps.length; k++, stepNo++) {
      // Bỏ qua phần nến TRƯỚC lúc khớp lệnh — lúc đó chưa có lệnh nào để thắng
      // hay thua. Không có nến 1m thì entryStep = 0 nên không bỏ gì cả.
      if (j === entryIdx && k < entryStep) { stepNo--; continue; }
      const isFillStep = j === entryIdx && k === entryStep;
      if (!isFillStep) resolvedExit = resolvedExit || resolved;

      const b = steps[k];
      const slHit = long ? b.l <= call.sl : b.h >= call.sl;
      // Trên chính bước khớp lệnh: không biết lệnh vào ở giây thứ mấy, nên phần
      // nào của bước xảy ra sau khi vào cũng không biết. Chốt lời không tính.
      const tp1Hit = !isFillStep && (long ? b.h >= call.tp1 : b.l <= call.tp1);
      const tp2Hit = !isFillStep && (long ? b.h >= call.tp2 : b.l <= call.tp2);

      const beArmed = opt.breakevenAfterTP1 && hitTP1 && tp1Step >= 0 && stepNo > tp1Step;
      const beHit = beArmed && (long ? b.l <= entry : b.h >= entry);

      // Stop đã dời về hoà vốn thì stop gốc không còn hiệu lực: muốn xuống tới nó
      // giá phải đi qua giá vào lệnh trước, nên hai trường hợp đều là thoát hoà vốn.
      if (beArmed && (beHit || slHit)) {
        exitIdx = j;
        r = 0.5 * R(call.tp1) + 0.5 * 0;
        exitReason = 'tp1-then-be';
        return mk(slipR);
      }
      // Trong cùng một bước, dữ liệu không nói được thứ tự — luôn tính SL trước.
      if (slHit) {
        exitIdx = j;
        if (hitTP1) { r = 0.5 * R(call.tp1) + 0.5 * -1; exitReason = 'tp1-then-sl'; }
        else { r = -1; exitReason = 'sl'; }
        return mk(slipR);
      }
      if (!hitTP1 && tp1Hit) { hitTP1 = true; tp1Step = stepNo; }
      if (hitTP1 && !hitTP2 && tp2Hit) {
        hitTP2 = true;
        exitIdx = j;
        // 50% ở TP1, 30% ở TP2, 20% runner cũng đóng luôn tại TP2 cho khỏi đoán.
        r = 0.5 * R(call.tp1) + 0.5 * R(call.tp2);
        exitReason = 'tp2';
        return mk(0);
      }
    }
  }

  // Hết hạn giữ: phần còn lại đóng theo giá đóng cửa.
  const close = candles[exitIdx].c;
  r = hitTP1 ? 0.5 * R(call.tp1) + 0.5 * R(close) : R(close);
  exitReason = hitTP1 ? 'tp1-then-timeout' : 'timeout';
  return mk(0);

  function mk(extraSlip: number): Trade {
    const costR = feeR + extraSlip;
    return {
      symbol: call.symbol, tf: call.tf, side: call.side,
      conviction: call.conviction, golden: call.golden, net: call.net,
      signalIdx: from, signalTime: candles[from].t,
      entryIdx, entry, sl: call.sl, tp1: call.tp1, tp2: call.tp2,
      exitIdx, exitReason, hitTP1, hitTP2,
      r: r - costR, rGross: r, costR,
      evidence: call.evidence.map((e) => ({ label: e.label, points: e.points })),
      warningCount: call.warnings.length,
      rewardRatio: call.rewardRatio,
      expectancyR: call.expectancy?.net ?? null,
      pWin: call.expectancy?.pWin ?? null,
      rr1: R(call.tp1), rr2: R(call.tp2),
      slPct: (risk / entry) * 100,
      entryDistPct: (Math.abs(entry - candles[from].c) / candles[from].c) * 100,
      unanimous: call.unanimous,
      tradeable: call.tradeable,
      intrabarResolved: anyResolved && resolvedExit,
    };
  }
}

export function runBacktest(
  symbol: string,
  tf: TF,
  candles: Candle[],
  opt: BTOptions = DEFAULT_BT,
  ctx?: SimContext,
): Trade[] {
  const window = BT_WINDOW[tf];
  const trades: Trade[] = [];
  let busyUntil = -1;

  for (let i = window; i < candles.length - 2; i++) {
    if (opt.onePositionAtATime && i <= busyUntil) continue;
    const call = signalAt(symbol, tf, candles, i, window, opt.weights, opt.valueMigration, opt.maxVAoverATR);
    if (!call) continue;
    if (RANK[call.conviction] < RANK[opt.minConviction]) continue;
    if (opt.minNet !== null && Math.abs(call.net) < opt.minNet) continue;
    if (opt.maxRewardRatio !== null && call.rewardRatio !== null && call.rewardRatio > opt.maxRewardRatio) continue;
    if (opt.minExpectancy !== null && call.expectancy !== null && call.expectancy.net < opt.minExpectancy) continue;
    const eRef = call.side === 'LONG' ? call.entry[1] : call.entry[0];
    const slPct = eRef > 0 ? (Math.abs(eRef - call.sl) / eRef) * 100 : 0;
    if (opt.maxSLPct !== null && slPct > opt.maxSLPct) continue;
    if (opt.minSLPct !== null && slPct < opt.minSLPct) continue;
    if (opt.maxEntryDistPct !== null) {
      const px = candles[i].c;
      if (px > 0 && (Math.abs(eRef - px) / px) * 100 > opt.maxEntryDistPct) continue;
    }

    const t = simulate(candles, i, call, opt, ctx);
    if (!t) continue;
    trades.push(t);
    busyUntil = t.exitIdx;
  }
  return trades;
}

export function stats(trades: Trade[]): BTStats {
  const n = trades.length;
  if (n === 0) {
    return { trades: 0, wins: 0, winRate: 0, totalR: 0, avgR: 0, profitFactor: 0, maxDrawdownR: 0, tp1Rate: 0, tp2Rate: 0 };
  }
  const wins = trades.filter((t) => t.r > 0).length;
  const totalR = trades.reduce((s, t) => s + t.r, 0);
  const gain = trades.filter((t) => t.r > 0).reduce((s, t) => s + t.r, 0);
  const loss = -trades.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);

  let peak = 0;
  let cum = 0;
  let dd = 0;
  for (const t of trades) {
    cum += t.r;
    if (cum > peak) peak = cum;
    dd = Math.max(dd, peak - cum);
  }

  return {
    trades: n,
    wins,
    winRate: (wins / n) * 100,
    totalR,
    avgR: totalR / n,
    profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : 0,
    maxDrawdownR: dd,
    tp1Rate: (trades.filter((t) => t.hitTP1).length / n) * 100,
    tp2Rate: (trades.filter((t) => t.hitTP2).length / n) * 100,
  };
}

/**
 * Đo EDGE THẬT của từng vế chấm điểm.
 *
 * Với mỗi vế: so R trung bình của các lệnh mà vế đó ỦNG HỘ hướng đã vào, với các
 * lệnh mà nó CHỐNG LẠI. Chênh lệch dương nghĩa là vế đó thật sự mang thông tin;
 * quanh 0 hoặc âm nghĩa là trọng số đang đặt cho nó là niềm tin chứ không phải
 * bằng chứng.
 */
export function evidenceEdge(trades: Trade[]): {
  label: string; agreeN: number; agreeR: number; againstN: number; againstR: number; edge: number;
}[] {
  const labels = [...new Set(trades.flatMap((t) => t.evidence.map((e) => e.label)))];
  return labels.map((label) => {
    const agree: number[] = [];
    const against: number[] = [];
    for (const t of trades) {
      const e = t.evidence.find((x) => x.label === label);
      if (!e || Math.abs(e.points) < 1) continue;
      const supportsLong = e.points > 0;
      const supportsSide = t.side === 'LONG' ? supportsLong : !supportsLong;
      (supportsSide ? agree : against).push(t.r);
    }
    const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    return {
      label,
      agreeN: agree.length, agreeR: avg(agree),
      againstN: against.length, againstR: avg(against),
      edge: avg(agree) - avg(against),
    };
  }).sort((a, b) => b.edge - a.edge);
}

/**
 * Vì sao hạng vàng không bao giờ bắn trên dữ liệu thật.
 *
 * Đếm trên MỌI tín hiệu (không chỉ những cái thành lệnh) xem điều kiện nào chặn
 * nhiều nhất. Một hạng không bao giờ đạt thì dù có test chứng minh nó đạt được
 * trên fixture, ngoài đời nó vẫn là code chết.
 */
export function goldDiagnostics(
  symbol: string,
  tf: TF,
  candles: Candle[],
): { signals: number; golden: number; blockers: { reason: string; n: number; pct: number }[] } {
  const window = BT_WINDOW[tf];
  const tally = new Map<string, number>();
  let signals = 0;
  let golden = 0;

  for (let i = window; i < candles.length; i++) {
    const call = signalAt(symbol, tf, candles, i, window);
    if (!call) continue;
    signals++;
    if (call.golden) { golden++; continue; }
    for (const b of call.goldenBlockers) {
      // gộp theo LOẠI điều kiện, bỏ phần số cụ thể
      const kind = b.split(' ').slice(0, 2).join(' ').replace(/[0-9.]+/g, '').trim()
        || b.slice(0, 20);
      tally.set(kind, (tally.get(kind) ?? 0) + 1);
    }
  }

  const blockers = [...tally].map(([reason, n]) => ({
    reason, n, pct: signals ? (n / signals) * 100 : 0,
  })).sort((a, b) => b.n - a.n);
  return { signals, golden, blockers };
}

/**
 * Hiệu chuẩn ngưỡng bằng dữ liệu: chia lệnh theo từng tiêu chí rồi xem avgR nhảy
 * bậc ở đâu. Đây là cách đặt ngưỡng hạng vàng dựa trên kết quả thay vì cảm tính.
 */
export function calibrate(trades: Trade[]): { dim: string; bucket: string; n: number; avgR: number; pf: number }[] {
  const out: { dim: string; bucket: string; n: number; avgR: number; pf: number }[] = [];
  const put = (dim: string, bucket: string, ts: Trade[]) => {
    if (ts.length === 0) return;
    const s = stats(ts);
    out.push({ dim, bucket, n: ts.length, avgR: s.avgR, pf: s.profitFactor });
  };

  for (const [lo, hi] of [[0, 10], [10, 20], [20, 30], [30, 40], [40, 200]]) {
    put('|net|', `${lo}–${hi}`, trades.filter((t) => Math.abs(t.net) >= lo && Math.abs(t.net) < hi));
  }
  for (const n of [0, 1, 2]) {
    put('số cảnh báo', n === 2 ? '≥2' : String(n),
      trades.filter((t) => (n === 2 ? t.warningCount >= 2 : t.warningCount === n)));
  }
  put('nhất trí', 'không vế nào ngược', trades.filter((t) => t.unanimous));
  put('nhất trí', 'có vế ngược', trades.filter((t) => !t.unanimous));
  for (const [lo, hi] of [[-99, 0.5], [0.5, 1], [1, 1.5], [1.5, 99]]) {
    put('R kỳ vọng', `${lo}–${hi}`,
      trades.filter((t) => t.expectancyR != null && t.expectancyR >= lo && t.expectancyR < hi));
  }
  // Độ rộng stop: stop rộng vừa ăn phí nặng theo R, vừa là dấu hiệu mức giá được
  // dựng từ một node ở quá xa — đúng ca ENA 1d ra entry cách giá 7.9%.
  for (const [lo, hi] of [[0, 1], [1, 2], [2, 3], [3, 5], [5, 999]]) {
    put('SL cách entry (% giá)', `${lo}–${hi}%`,
      trades.filter((t) => t.slPct >= lo && t.slPct < hi));
  }
  for (const [lo, hi] of [[0, 0.5], [0.5, 1], [1, 2], [2, 4], [4, 999]]) {
    put('entry cách giá (%)', `${lo}–${hi}%`,
      trades.filter((t) => t.entryDistPct >= lo && t.entryDistPct < hi));
  }

  // Ứng viên cho định nghĩa hạng vàng mới, đối chiếu với định nghĩa cũ.
  const net30 = (t: Trade) => Math.abs(t.net) >= 30;
  const net40 = (t: Trade) => Math.abs(t.net) >= 40;
  put('ứng viên vàng', 'net≥30', trades.filter(net30));
  put('ứng viên vàng', 'net≥30 + nhất trí', trades.filter((t) => net30(t) && t.unanimous));
  put('ứng viên vàng', 'net≥40 + nhất trí', trades.filter((t) => net40(t) && t.unanimous));
  put('ứng viên vàng', 'net≥30 + nhất trí + Rkv<1.5',
    trades.filter((t) => net30(t) && t.unanimous && t.expectancyR != null && t.expectancyR > 0));
  put('ứng viên vàng', 'CŨ: +Rkv≥1 +0 c.báo',
    trades.filter((t) => net40(t) && t.unanimous && (t.expectancyR ?? -1) > 0 && t.warningCount === 0));
  return out;
}
