/**
 * Phí giao dịch, đặt riêng một chỗ.
 *
 * Trước đây hằng số này nằm trong direct.ts, mà decide.ts (chỗ dựng mức giá) thì
 * KHÔNG import được direct.ts — direct.ts đã import ngược lại decide.ts. Hệ quả:
 * bộ dựng mức giá không thể biết chi phí là bao nhiêu, nên nó đặt TP1 theo ATR và
 * bin size thuần tuý, và trên khung nhỏ lúc thị trường lặng thì mục tiêu rơi vào
 * trong phí. Tách ra đây để cả hai bên cùng nhìn một con số.
 */
export const FEES = { perSide: 0.0005, slip: 0.0002 };

/** Chi phí một vòng vào-ra, tính theo tỉ lệ giá. */
export const ROUND_TRIP = FEES.perSide * 2 + FEES.slip;

/** Phí quy ra R cho một stop rộng `risk` trên giá `entry`. */
export function feeInR(entry: number, risk: number): number | null {
  if (!(entry > 0) || !(risk > 0)) return null;
  return (ROUND_TRIP * entry) / risk;
}
