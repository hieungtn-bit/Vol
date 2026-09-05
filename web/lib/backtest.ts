import { prepareTF } from './analyze';
import { decideDirection, type Conviction, type DirectionalCall } from './direct';
import { buildFlow } from './flow';
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
  /** Số nến chờ giá chạm vùng entry. Quá hạn thì bỏ kèo, không tính là lệnh. */
  entryWindow: number;
  /** Tối đa giữ lệnh bao nhiêu nến trước khi đóng theo giá thị trường. */
  maxHold: number;
  /** Chỉ nhận tín hiệu từ hạng này trở lên. */
  minConviction: Conviction;
  /** Không mở lệnh mới khi đang có lệnh chạy — giống người thật. */
  onePositionAtATime: boolean;
}

export const DEFAULT_BT: BTOptions = {
  entryWindow: 12,
  maxHold: 60,
  minConviction: 'C',
  onePositionAtATime: true,
};

const RANK: Record<Conviction, number> = { C: 0, B: 1, A: 2, GOLD: 3 };

export type ExitReason = 'tp2' | 'tp1-then-sl' | 'tp1-then-timeout' | 'sl' | 'timeout';

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
  /** R thực hiện của cả kế hoạch: 50% ở TP1, 30% ở TP2, 20% đóng khi hết hạn giữ. */
  r: number;
  /** Bằng chứng lúc phát tín hiệu — để đo vế nào thật sự có edge. */
  evidence: { label: string; points: number }[];
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
      markPrice: null, flat: false, extreme: false, note: 'N/A — backtest mù phái sinh.',
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
): DirectionalCall | null {
  const slice = sliceAsOf(candles, i, window);
  const deriv = blindDerivatives();
  const prepared = prepareTF({ symbol, tf, candles: slice, deriv, htf: null, hasClosedBar: true });
  if (!prepared) return null;
  const flow = buildFlow(null, slice, { retailLongPct: null, topLongPct: null }, deriv.funding);
  return decideDirection(prepared.input, prepared.structure, flow);
}

/**
 * Mô phỏng một lệnh từ tín hiệu ở nến `from`.
 *
 * Entry là lệnh chờ ở MÉP GẦN NHẤT của vùng: long chờ giá xuống nên khớp ở mép
 * trên, short chờ giá lên nên khớp ở mép dưới. Đó cũng là mép xấu hơn cho người
 * vào lệnh, đúng tinh thần nghi ngờ thì chọn phía xấu.
 */
export function simulate(
  candles: Candle[],
  from: number,
  call: DirectionalCall,
  opt: BTOptions,
): Trade | null {
  const long = call.side === 'LONG';
  const entry = long ? call.entry[1] : call.entry[0];
  const risk = Math.abs(entry - call.sl);
  if (!(risk > 0)) return null;

  // 1. Chờ khớp
  let entryIdx = -1;
  for (let j = from + 1; j <= Math.min(from + opt.entryWindow, candles.length - 1); j++) {
    const b = candles[j];
    if (long ? b.l <= entry : b.h >= entry) { entryIdx = j; break; }
  }
  if (entryIdx < 0) return null;   // không khớp thì không phải một lệnh

  // 2. Đi tiếp
  let hitTP1 = false;
  let hitTP2 = false;
  let exitIdx = Math.min(entryIdx + opt.maxHold, candles.length - 1);
  let exitReason: ExitReason = 'timeout';
  let r = 0;

  const R = (price: number) => (long ? price - entry : entry - price) / risk;

  for (let j = entryIdx; j <= Math.min(entryIdx + opt.maxHold, candles.length - 1); j++) {
    const b = candles[j];
    const slHit = long ? b.l <= call.sl : b.h >= call.sl;
    const tp1Hit = long ? b.h >= call.tp1 : b.l <= call.tp1;
    const tp2Hit = long ? b.h >= call.tp2 : b.l <= call.tp2;

    // Trong cùng một nến, dữ liệu nến không nói được thứ tự — luôn tính SL trước.
    if (slHit) {
      exitIdx = j;
      if (hitTP1) { r = 0.5 * R(call.tp1) + 0.5 * -1; exitReason = 'tp1-then-sl'; }
      else { r = -1; exitReason = 'sl'; }
      return mk();
    }
    if (!hitTP1 && tp1Hit) hitTP1 = true;
    if (hitTP1 && !hitTP2 && tp2Hit) {
      hitTP2 = true;
      exitIdx = j;
      // 50% ở TP1, 30% ở TP2, 20% runner cũng đóng luôn tại TP2 cho khỏi đoán.
      r = 0.5 * R(call.tp1) + 0.5 * R(call.tp2);
      exitReason = 'tp2';
      return mk();
    }
  }

  // Hết hạn giữ: phần còn lại đóng theo giá đóng cửa.
  const close = candles[exitIdx].c;
  r = hitTP1 ? 0.5 * R(call.tp1) + 0.5 * R(close) : R(close);
  exitReason = hitTP1 ? 'tp1-then-timeout' : 'timeout';
  return mk();

  function mk(): Trade {
    return {
      symbol: call.symbol, tf: call.tf, side: call.side,
      conviction: call.conviction, golden: call.golden, net: call.net,
      signalIdx: from, signalTime: candles[from].t,
      entryIdx, entry, sl: call.sl, tp1: call.tp1, tp2: call.tp2,
      exitIdx, exitReason, hitTP1, hitTP2, r,
      evidence: call.evidence.map((e) => ({ label: e.label, points: e.points })),
    };
  }
}

export function runBacktest(
  symbol: string,
  tf: TF,
  candles: Candle[],
  opt: BTOptions = DEFAULT_BT,
): Trade[] {
  const window = BT_WINDOW[tf];
  const trades: Trade[] = [];
  let busyUntil = -1;

  for (let i = window; i < candles.length - 2; i++) {
    if (opt.onePositionAtATime && i <= busyUntil) continue;
    const call = signalAt(symbol, tf, candles, i, window);
    if (!call) continue;
    if (RANK[call.conviction] < RANK[opt.minConviction]) continue;

    const t = simulate(candles, i, call, opt);
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
