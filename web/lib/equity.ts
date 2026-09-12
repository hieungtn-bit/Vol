import type { Trade } from './backtest';
import { FEES } from './direct';

// ============================================================
// AVGR KHÔNG TRẢ LỜI ĐƯỢC CÂU CỦA NGƯỜI CẦM TIỀN.
//
// "avgR 0.18, PF 1.50" nói về một lệnh trung bình. Người sắp vào tiền hỏi ba câu
// khác hẳn:
//
//   1. 1000 USDT thành bao nhiêu, sau bao lâu?
//   2. Có lúc nào tụt xuống bao nhiêu? Tụt trong bao lâu?
//   3. Thua liên tiếp dài nhất mấy lệnh?
//
// Câu 2 và 3 mới là thứ quyết định người ta có đi hết đường hay bỏ giữa chừng.
// Một hệ avgR dương mà có lúc âm 30% tài khoản trong sáu tuần thì phần lớn người
// sẽ bỏ đúng lúc đáy — và khi đó avgR 0.18 chưa bao giờ đến tay họ.
//
// RỦI RO CỐ ĐỊNH THEO % VỐN, tức mỗi lệnh đặt bằng nhau theo tỉ lệ, không phải
// bằng nhau theo tiền. Đó là cách bảng vào tiền tính khối lượng, nên mô phỏng
// phải tính đúng như vậy, nếu không con số ở đây không nói về cái người dùng làm.
// ============================================================

export interface EquityOptions {
  /** Vốn ban đầu, USDT. */
  equity: number;
  /** Rủi ro mỗi lệnh, % vốn HIỆN TẠI. */
  riskPct: number;
  /**
   * Trần số lệnh mở cùng lúc. Backtest đã ép một lệnh mỗi lúc trên mỗi cặp
   * mã×khung, nhưng nhiều cặp có thể mở cùng thời điểm — và crypto thì thường
   * cùng chiều, nên rủi ro thật cộng dồn chứ không bù nhau.
   */
  maxConcurrent: number;
}

export const DEFAULT_EQUITY: EquityOptions = { equity: 1000, riskPct: 1, maxConcurrent: 3 };

export interface EquityPoint {
  t: number;
  equity: number;
  /** Sụt so với đỉnh cao nhất từ trước tới giờ, tính theo %. */
  drawdownPct: number;
}

export interface EquityResult {
  points: EquityPoint[];
  start: number;
  end: number;
  /** Lãi/lỗ tính theo % vốn ban đầu. */
  returnPct: number;
  /** Sụt giảm sâu nhất, theo % đỉnh. */
  maxDrawdownPct: number;
  /** Số tiền tại đáy sâu nhất. */
  troughEquity: number;
  /** Bao nhiêu ngày kể từ lúc rời đỉnh tới lúc lấy lại được đỉnh đó. */
  longestUnderwaterDays: number;
  /** Chuỗi thua liên tiếp dài nhất. */
  longestLossStreak: number;
  /** Số lệnh đã vào. */
  trades: number;
  /** Số lệnh bị bỏ vì đã kín chỗ. */
  skippedFull: number;
  days: number;
}

/**
 * Chạy lại chuỗi lệnh trên một tài khoản thật.
 *
 * `trades` phải là các lệnh ĐÃ QUA CỬA, sắp theo thời gian tín hiệu. R của mỗi
 * lệnh đã trừ phí ở backtest, nên ở đây chỉ nhân R với số tiền rủi ro — KHÔNG
 * trừ phí lần nữa.
 */
export function runEquity(trades: Trade[], opt: EquityOptions = DEFAULT_EQUITY): EquityResult {
  const sorted = [...trades].sort((a, b) => a.signalTime - b.signalTime);
  let equity = opt.equity;
  let peak = equity;
  let maxDD = 0;
  let trough = equity;
  let streak = 0;
  let worstStreak = 0;
  let taken = 0;
  let skipped = 0;

  // Thời điểm đóng của các lệnh đang mở — để đếm chỗ trống.
  let dangMo: number[] = [];
  let peakAt = sorted.length ? sorted[0].signalTime : 0;
  let worstUnderwater = 0;

  const points: EquityPoint[] = [];

  for (const t of sorted) {
    // Giải phóng chỗ của các lệnh đã đóng trước thời điểm này.
    dangMo = dangMo.filter((x) => x > t.signalTime);
    if (dangMo.length >= opt.maxConcurrent) { skipped++; continue; }

    const riskMoney = equity * (opt.riskPct / 100);
    equity += t.r * riskMoney;
    taken++;

    // Thời điểm đóng xấp xỉ: dùng chính mốc tín hiệu cộng số nến giữ. Backtest
    // không lưu mốc đóng, nên đây là xấp xỉ — chỉ dùng để đếm chỗ, không dùng
    // để tính tiền.
    dangMo.push(t.signalTime + Math.max(1, t.exitIdx - t.signalIdx) * 3_600_000);

    if (t.r > 0) { streak = 0; } else { streak++; worstStreak = Math.max(worstStreak, streak); }

    if (equity > peak) {
      worstUnderwater = Math.max(worstUnderwater, t.signalTime - peakAt);
      peak = equity;
      peakAt = t.signalTime;
    }
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDD) { maxDD = dd; trough = equity; }

    points.push({ t: t.signalTime, equity, drawdownPct: dd });
  }

  // Nếu kết thúc mà vẫn dưới đỉnh thì quãng chìm cuối cũng phải tính.
  if (points.length && equity < peak) {
    worstUnderwater = Math.max(worstUnderwater, points[points.length - 1].t - peakAt);
  }

  const days = points.length >= 2
    ? (points[points.length - 1].t - points[0].t) / 86_400_000
    : 0;

  return {
    points, start: opt.equity, end: equity,
    returnPct: ((equity - opt.equity) / opt.equity) * 100,
    maxDrawdownPct: maxDD,
    troughEquity: trough,
    longestUnderwaterDays: worstUnderwater / 86_400_000,
    longestLossStreak: worstStreak,
    trades: taken,
    skippedFull: skipped,
    days,
  };
}

/** Phí quy ra R cho một stop rộng bấy nhiêu % giá — để đối chiếu nhanh. */
export function feeDragR(slPct: number): number {
  return slPct > 0 ? ((FEES.perSide * 2 + FEES.slip) * 100) / slPct : NaN;
}
