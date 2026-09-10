import { FEES } from './direct';

// ============================================================
// TỪ MỘT KÈO SANG MỘT LỆNH THẬT.
//
// Bảng cũ trả lời "vào bên nào". Bảng này trả lời "đặt bao nhiêu, ở đâu, và mất
// bao nhiêu tiền nếu sai" — ba câu phải biết trước khi bấm nút.
//
// MỌI CON SỐ Ở ĐÂY KHỚP VỚI CÁI BACKTEST ĐO. Chia 50/50 ở hai mốc chốt đúng như
// `simulate()` trả tiền; phí tính taker cả hai chiều đúng như backtest trừ. Nếu
// bảng tính một kiểu mà backtest đo một kiểu thì con số kỳ vọng in ra ở đây
// không nói về cái mà người dùng sắp làm.
// ============================================================

/** Vào lệnh một lần, ra làm hai — 50% ở TP1, 50% ở TP2. */
export const LEG = 0.5;

export interface SizingInput {
  side: 'LONG' | 'SHORT';
  /** Vùng chờ khớp [thấp, cao]. Long khớp ở mép TRÊN, short ở mép DƯỚI. */
  entry: [number, number];
  sl: number;
  tp1: number;
  tp2: number;
  /** Vốn tài khoản, tính bằng USDT. */
  equity: number;
  /** Rủi ro mỗi lệnh, tính theo % vốn. */
  riskPct: number;
}

export interface OrderPlan {
  /** Giá đặt lệnh chờ. */
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  /** Khối lượng, tính bằng coin. */
  qty: number;
  /** Khối lượng mỗi lần chốt. */
  qtyLeg: number;
  /** Giá trị vị thế (USDT). */
  notional: number;
  /** Tiền mất nếu chạm stop, TRƯỚC phí. */
  riskMoney: number;
  /** Khoảng cách stop tính theo % giá. */
  slPct: number;
  /** Phí vòng vào-ra, quy ra tiền. */
  feeMoney: number;
  /** Đòn bẩy cần để mở vị thế này với số vốn đó. */
  leverage: number;
  /**
   * Đòn bẩy TỐI ĐA còn an toàn.
   *
   * Với đòn bẩy L, ký quỹ chỉ bằng 1/L giá trị vị thế, nên giá đi ngược khoảng
   * 1/L là cháy. Muốn stop chạm TRƯỚC khi cháy thì cần stop% < 1/L. Lấy hệ số an
   * toàn 2 lần cho phí, funding và trượt giá.
   *
   * Đây là số học, không phải khẩu vị rủi ro: vượt mức này thì sàn đóng lệnh
   * trước khi stop của mình kịp chạy, và mất nhiều hơn con số "rủi ro mỗi lệnh"
   * đã chọn.
   */
  maxSafeLeverage: number;
  /** Ba kết cục mà backtest thật sự mô phỏng, quy ra tiền và đã trừ phí. */
  outcomes: {
    /** Chạm cả hai mốc chốt. */
    bothTP: number;
    /** Chạm TP1 rồi quay về stop. */
    tp1ThenSL: number;
    /** Thủng stop, chưa chạm mốc nào. */
    stopped: number;
  };
  /** Tỷ lệ lời/lỗ nếu chạm cả hai mốc, tính bằng R. */
  rewardR: number;
}

/**
 * Dựng lệnh. Trả null khi kèo không dựng được lệnh hợp lệ — KHÔNG nắn số cho
 * vừa: stop nằm sai phía, hoặc vốn/rủi ro không hợp lệ, thì không có lệnh nào cả.
 */
export function planOrder(i: SizingInput): OrderPlan | null {
  const long = i.side === 'LONG';
  const entryPrice = long ? i.entry[1] : i.entry[0];

  if (!(entryPrice > 0) || !(i.equity > 0) || !(i.riskPct > 0)) return null;
  // Stop phải nằm ĐÚNG PHÍA: dưới entry khi long, trên khi short.
  if (long ? i.sl >= entryPrice : i.sl <= entryPrice) return null;
  // Mốc chốt phải nằm đúng phía và đúng thứ tự.
  if (long ? !(i.tp1 > entryPrice && i.tp2 > i.tp1) : !(i.tp1 < entryPrice && i.tp2 < i.tp1)) return null;

  const riskDist = Math.abs(entryPrice - i.sl);
  const riskMoney = i.equity * (i.riskPct / 100);
  const qty = riskMoney / riskDist;
  const notional = qty * entryPrice;
  const slPct = (riskDist / entryPrice) * 100;

  // Phí taker cả hai chiều, đúng như backtest trừ.
  const feeMoney = notional * FEES.perSide * 2;
  const slipMoney = notional * FEES.slip;

  const gain = (px: number) => (long ? px - entryPrice : entryPrice - px) * qty;

  return {
    entryPrice, sl: i.sl, tp1: i.tp1, tp2: i.tp2,
    qty, qtyLeg: qty * LEG,
    notional, riskMoney, slPct, feeMoney,
    leverage: notional / i.equity,
    maxSafeLeverage: 100 / (slPct * 2),
    outcomes: {
      bothTP: LEG * gain(i.tp1) + LEG * gain(i.tp2) - feeMoney,
      tp1ThenSL: LEG * gain(i.tp1) + LEG * -riskMoney - feeMoney - slipMoney,
      stopped: -riskMoney - feeMoney - slipMoney,
    },
    rewardR: (LEG * gain(i.tp1) + LEG * gain(i.tp2)) / riskMoney,
  };
}

/** Làm tròn khối lượng cho dễ đặt tay. Không phải bước giá của sàn. */
export function prettyQty(q: number): string {
  if (q >= 1000) return q.toFixed(0);
  if (q >= 1) return q.toFixed(2);
  if (q >= 0.01) return q.toFixed(4);
  return q.toFixed(6);
}

export function money(x: number): string {
  const s = Math.abs(x) >= 1000 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3);
  return `${x > 0 ? '+' : ''}${s}`;
}
