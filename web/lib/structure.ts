import { findSwings } from './priceAction';
import type { Candle, Swing } from './types';

// ============================================================
// Cấu trúc thị trường bằng HH / HL / LH / LL.
// Đây là cách đọc xu hướng KHÔNG dùng chỉ báo: chỉ so đỉnh với đỉnh,
// đáy với đáy. Đỉnh sau cao hơn đỉnh trước = HH, thấp hơn = LH; tương tự
// đáy sau cao hơn = HL, thấp hơn = LL.
// ============================================================

export type SwingLabel = 'HH' | 'LH' | 'HL' | 'LL';

export interface LabeledSwing extends Swing {
  label: SwingLabel;
  /** % chênh so với swing cùng loại liền trước. */
  deltaPct: number;
}

export type StructureState =
  | 'uptrend'        // HH + HL — phe mua đang dẫn
  | 'downtrend'      // LH + LL — phe bán đang dẫn
  | 'broadening'     // HH + LL — biên nới ra hai phía, biến động tăng
  | 'contracting'    // LH + HL — nén lại, sắp chọn hướng
  | 'unclear';

export interface MarketStructure {
  highs: LabeledSwing[];
  lows: LabeledSwing[];
  lastHigh: LabeledSwing | null;
  lastLow: LabeledSwing | null;
  state: StructureState;
  /** -100 (giảm rõ) .. +100 (tăng rõ). Dùng làm một vế chấm điểm hướng. */
  bias: number;
  /** Mức mà nếu ĐÓNG qua sẽ bẻ gãy cấu trúc hiện tại. */
  breakLevel: number | null;
  note: string;
}

const EMPTY: MarketStructure = {
  highs: [], lows: [], lastHigh: null, lastLow: null,
  state: 'unclear', bias: 0, breakLevel: null,
  note: 'Chưa đủ swing để đọc cấu trúc.',
};

function label(swings: Swing[], kind: 'H' | 'L'): LabeledSwing[] {
  const out: LabeledSwing[] = [];
  for (let i = 0; i < swings.length; i++) {
    const prev = i > 0 ? swings[i - 1].price : null;
    const p = swings[i].price;
    const deltaPct = prev ? ((p - prev) / prev) * 100 : 0;
    // Swing đầu tiên chưa có gì để so — coi là "cùng chiều" với loại của nó
    // thay vì bịa ra một nhãn mạnh.
    const higher = prev == null ? true : p > prev;
    out.push({
      ...swings[i],
      label: kind === 'H' ? (higher ? 'HH' : 'LH') : (higher ? 'HL' : 'LL'),
      deltaPct,
    });
  }
  return out;
}

export function analyzeStructure(candlesIn: Candle[], lookback = 60): MarketStructure {
  const candles = candlesIn.filter((c) => c.closed).slice(-lookback);
  if (candles.length < 12) return EMPTY;

  const { highs: rawH, lows: rawL } = findSwings(candles);
  if (rawH.length === 0 && rawL.length === 0) return EMPTY;

  const highs = label(rawH, 'H');
  const lows = label(rawL, 'L');
  const lastHigh = highs.length ? highs[highs.length - 1] : null;
  const lastLow = lows.length ? lows[lows.length - 1] : null;

  let state: StructureState = 'unclear';
  if (lastHigh && lastLow) {
    const h = lastHigh.label;
    const l = lastLow.label;
    if (h === 'HH' && l === 'HL') state = 'uptrend';
    else if (h === 'LH' && l === 'LL') state = 'downtrend';
    else if (h === 'HH' && l === 'LL') state = 'broadening';
    else if (h === 'LH' && l === 'HL') state = 'contracting';
  }

  // Điểm hướng: nhãn gần nhất nặng hơn nhãn cũ, và biên độ chênh cũng tính.
  let bias = 0;
  const score = (ls: LabeledSwing[], up: SwingLabel) => {
    const tail = ls.slice(-3);
    let s = 0;
    tail.forEach((x, i) => {
      const w = [0.5, 0.8, 1.2][i + (3 - tail.length)] ?? 1;
      const mag = Math.min(1, Math.abs(x.deltaPct) / 3);   // >3% coi là đã rõ
      s += (x.label === up ? 1 : -1) * w * (0.5 + 0.5 * mag);
    });
    return s;
  };
  bias += score(highs, 'HH') * 20;
  bias += score(lows, 'HL') * 20;
  bias = Math.max(-100, Math.min(100, bias));

  // Cấu trúc tăng chết khi đóng dưới HL gần nhất; cấu trúc giảm chết khi đóng trên LH gần nhất.
  const breakLevel =
    state === 'uptrend' ? lastLow?.price ?? null
    : state === 'downtrend' ? lastHigh?.price ?? null
    : null;

  const VI: Record<StructureState, string> = {
    uptrend: 'HH + HL — phe mua đang dẫn cấu trúc',
    downtrend: 'LH + LL — phe bán đang dẫn cấu trúc',
    broadening: 'HH + LL — biên nới ra hai phía, biến động đang tăng',
    contracting: 'LH + HL — đang nén lại, sắp chọn hướng',
    unclear: 'chưa đủ swing để kết luận',
  };

  return {
    highs, lows, lastHigh, lastLow, state, bias, breakLevel,
    note: `${VI[state]}${lastHigh ? ` · đỉnh gần nhất ${lastHigh.label}` : ''}${lastLow ? ` · đáy gần nhất ${lastLow.label}` : ''}`,
  };
}
