import { prepareTF } from './analyze';
import { BT_WINDOW, blindDerivatives, simulate, type BTOptions, type Trade } from './backtest';
import { DEFAULT_STRICT, decideBias, type StrictConfig } from './decide';
import { buildFlow } from './flow';
import type { DirectionalCall } from './direct';
import type { Candle, Recommendation, TF } from './types';

// ============================================================
// BACKTEST ĐƯỜNG STRICT (decideBias).
//
// Đường này CHƯA TỪNG được backtest. Mọi con số backtest trong repo tới nay đều
// đo `decideDirection` — đường "luôn ra hướng" của trang chính. `decideBias` chỉ
// được gọi từ analyze.ts và từ test. Nghĩa là ngưỡng score ≥ 7, các trọng số
// hợp lưu, và cả khoản phạt RR TP1 đều chưa bao giờ đi qua một lần đo nào.
//
// DÙNG CHUNG `simulate()` với đường kia. Nếu hai đường mô phỏng khác nhau thì
// chênh lệch có thể đến từ luật vào lệnh chứ không phải từ thuật toán, và phép
// so thành vô nghĩa.
// ============================================================

/**
 * `simulate()` nhận `DirectionalCall`. `decideBias` trả `Recommendation` — khác
 * hình dạng nhưng cùng nội dung ở phần mô phỏng cần: hướng và bốn mức giá.
 *
 * Chuyển đổi ở đây thay vì viết một bộ mô phỏng thứ hai. Các trường không có
 * nghĩa ở đường strict (hạng tin cậy, nhất trí, kỳ vọng) để giá trị trung tính
 * — KHÔNG bịa, và không trường nào trong số đó ảnh hưởng tới kết quả mô phỏng.
 */
export function recToCall(r: Recommendation): DirectionalCall | null {
  if (r.bias === 'WAIT' || !r.entry || r.sl == null || r.tp1 == null || r.tp2 == null) return null;
  return {
    symbol: r.symbol, tf: r.tf, side: r.bias,
    conviction: 'B', golden: false, goldenBlockers: [],
    net: r.confluence.score * 10,       // chỉ để ghi lại, không dùng khi mô phỏng
    longScore: 0, shortScore: 0,
    unanimous: true, contestedBy: [],
    triggerLevel: null, lifecycle: null,
    // Đường strict tự nó ĐÃ là cửa: ra được LONG/SHORT nghĩa là đã qua score ≥ 7
    // và cổng TF. Không có cửa thứ hai chồng lên.
    tradeable: true, gateBlockers: [],
    entry: r.entry, sl: r.sl, tp1: r.tp1, tp2: r.tp2,
    rr1: r.rr1, rr2: r.rr2, rrBlended: null,
    runner: r.runner, size: r.size,
    trigger: r.trigger, invalidation: r.invalidation,
    evidence: r.confluence.lines.map((l) => ({ label: l.label, side: 'neutral' as const, points: l.points, detail: '' })),
    structureNote: '', flowNote: '', fundingText: '',
    buyPctPerp: null, buyPctSpot: null,
    warnings: r.warnings, planText: r.planText,
  };
}

/** Cắt lát lịch sử tới nến i, mọi nến đánh dấu đã đóng — đúng trạng thái lúc đó. */
function sliceAsOf(candles: Candle[], i: number, window: number): Candle[] {
  const from = Math.max(0, i - window + 1);
  return candles.slice(from, i + 1).map((c) => (c.closed ? c : { ...c, closed: true }));
}

/** Khuyến nghị strict tại nến i, chỉ nhìn 0..i. */
export function strictAt(
  symbol: string, tf: TF, candles: Candle[], i: number,
  window = BT_WINDOW[tf],
  strict: StrictConfig = DEFAULT_STRICT,
): Recommendation | null {
  const slice = sliceAsOf(candles, i, window);
  const deriv = blindDerivatives();
  const prepared = prepareTF({ symbol, tf, candles: slice, deriv, htf: null, hasClosedBar: true });
  if (!prepared) return null;
  // buildFlow chỉ để có FlowInfo; decideBias không nhận flow ở chữ ký hiện tại.
  buildFlow(null, slice, { retailLongPct: null, topLongPct: null }, deriv.funding);
  return decideBias(prepared.input, strict);
}

export interface StrictRun {
  /** Số nến đã xét. */
  bars: number;
  /** Số nến ra được LONG/SHORT (không WAIT). */
  signals: number;
  trades: Trade[];
}

export function runBacktestStrict(
  symbol: string, tf: TF, candles: Candle[],
  opt: BTOptions,
  strict: StrictConfig = DEFAULT_STRICT,
): StrictRun {
  const window = BT_WINDOW[tf];
  const trades: Trade[] = [];
  let busyUntil = -1;
  let bars = 0;
  let signals = 0;

  for (let i = window; i < candles.length - 2; i++) {
    bars++;
    if (opt.onePositionAtATime && i <= busyUntil) continue;
    const rec = strictAt(symbol, tf, candles, i, window, strict);
    if (!rec) continue;
    const call = recToCall(rec);
    if (!call) continue;
    signals++;
    const t = simulate(candles, i, call, opt);
    if (!t) continue;
    trades.push(t);
    busyUntil = t.exitIdx;
  }
  return { bars, signals, trades };
}
