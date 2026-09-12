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
  /** Đòn bẩy đặt trên sàn cho vị thế này. */
  leverage: number;
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
  /** Đòn bẩy đang đặt. */
  leverage: number;
  /** Ký quỹ vị thế này chiếm, tính bằng USDT. */
  margin: number;
  /** Ký quỹ chiếm bao nhiêu % vốn. */
  marginPct: number;
  /**
   * Đòn bẩy TỐI ĐA còn an toàn.
   *
   * Với đòn bẩy L, ký quỹ chỉ bằng 1/L giá trị vị thế, nên giá đi ngược khoảng
   * 1/L là cháy. Muốn stop chạm TRƯỚC khi cháy thì cần stop% < 100/L. Hệ số an
   * toàn 2 lần cho phí, funding và trượt giá.
   *
   * Đây là số học, không phải khẩu vị rủi ro: vượt mức này thì sàn đóng lệnh
   * trước khi stop của mình kịp chạy, và mất nhiều hơn con số "rủi ro mỗi lệnh"
   * đã chọn.
   */
  maxSafeLeverage: number;
  /**
   * Giá thanh lý xấp xỉ, ở mức đòn bẩy đang đặt (isolated, bỏ qua ký quỹ duy trì).
   * Xấp xỉ vì mỗi sàn tính ký quỹ duy trì một kiểu — dùng để SO với stop, không
   * dùng để đặt lệnh.
   */
  liqPrice: number;
  /** Không mở nổi: ký quỹ vượt quá vốn. */
  khongDuVon: boolean;
  /**
   * Đòn bẩy vượt mức an toàn. Có HAI mức độ, và phải nói đúng cái nào:
   *  - `chayTruocStop`: thanh lý nằm TRONG stop → chắc chắn cháy trước.
   *  - còn lại: thanh lý vẫn ngoài stop nhưng đệm mỏng hơn hai lần độ rộng
   *    stop, tức phí, funding và trượt giá có thể ăn hết chỗ đó.
   */
  vuotDonBay: boolean;
  /** Thanh lý nằm TRONG stop — cháy trước khi stop kịp chạy. */
  chayTruocStop: boolean;
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

  if (!(entryPrice > 0) || !(i.equity > 0) || !(i.riskPct > 0) || !(i.leverage > 0)) return null;
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

  // Ký quỹ và thanh lý — hai câu hỏi KHÁC NHAU, và bản đầu của bảng này so nhầm
  // chúng với nhau. "Đòn bẩy cần = vị thế / vốn" nói vị thế lớn bằng bao nhiêu
  // phần tài khoản; "tối đa an toàn = 50/stop%" nói đòn bẩy đặt trên sàn tới mức
  // nào thì thanh lý còn xa hơn stop. So hai cái đó thì stop% triệt tiêu, và
  // cảnh báo chỉ bắn khi rủi ro mỗi lệnh > 50% vốn — tức không bao giờ.
  const margin = notional / i.leverage;
  const maxSafeLeverage = 100 / (slPct * 2);

  const gain = (px: number) => (long ? px - entryPrice : entryPrice - px) * qty;

  return {
    entryPrice, sl: i.sl, tp1: i.tp1, tp2: i.tp2,
    qty, qtyLeg: qty * LEG,
    notional, riskMoney, slPct, feeMoney,
    leverage: i.leverage,
    margin, marginPct: (margin / i.equity) * 100,
    maxSafeLeverage,
    liqPrice: long ? entryPrice * (1 - 1 / i.leverage) : entryPrice * (1 + 1 / i.leverage),
    khongDuVon: margin > i.equity,
    vuotDonBay: i.leverage > maxSafeLeverage,
    // Khoảng cách tới thanh lý là 100/L phần trăm. Nằm trong stop thì cháy trước.
    chayTruocStop: 100 / i.leverage < slPct,
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

// ------------------------------------------------------------
// RR NÀO ĐÁNG NHẬN — đo trên 386 lệnh qua cửa (bench/rr-hop-ly.txt).
//
//   RR kế hoạch   n     chạm TP1   chạm TP2   avgR     PF
//   0.5–0.8       73    71.2%      67.1%      0.09     1.26
//   0.8–1.1      107    69.2%      59.8%      0.19     1.53
//   1.1–1.5      102    66.7%      58.8%      0.34     1.92   ← tốt nhất
//   1.5–2.0       66    45.5%      33.3%     −0.05     0.91   ← TỆ NHẤT
//
// RR CAO HƠN KHÔNG TỐT HƠN, và có cơ chế rõ chứ không phải tương quan tình cờ:
// ở mốc 1.5 có một VÁCH RƠI về tỉ lệ chạm — TP1 từ 66.7% xuống 45.5%, TP2 từ
// 58.8% xuống 33.3%. Phần thưởng lớn hơn không bù nổi cú sụt đó.
//
// Lý do cơ học: TP2 đặt ở tham chiếu cấu trúc KẾ TIẾP, nên RR cao nghĩa là mốc
// đó ở xa — và nửa vị thế treo ở đó thường hết hạn giữ hoặc quay đầu.
//
// Vì vậy KHÔNG đặt mục tiêu RR. Hệ không cho chọn RR tuỳ ý: nó rơi ra từ chỗ
// các mốc cấu trúc nằm. Thứ dùng được là một luật ĐỌC, không phải một mục tiêu.
// ------------------------------------------------------------

export type RRVerdict = 'tot' | 'duoc' | 'kem' | 'it-mau';

export interface RRRead {
  verdict: RRVerdict;
  text: string;
}

export function readRR(rewardR: number): RRRead {
  if (rewardR >= 1.1 && rewardR < 1.5) {
    return { verdict: 'tot', text: 'Khoảng đo ra tốt nhất — avgR 0.34, PF 1.92 trên 102 lệnh.' };
  }
  if (rewardR >= 1.5 && rewardR < 2.0) {
    return {
      verdict: 'kem',
      text: 'Khoảng đo ra TỆ NHẤT — avgR −0.05 trên 66 lệnh. Ở mốc 1.5 tỉ lệ chạm sụt hẳn: '
        + 'TP1 còn 45%, TP2 còn 33%. Mục tiêu xa hơn không bù nổi việc ít chạm hơn.',
    };
  }
  if (rewardR >= 2.0) {
    return { verdict: 'it-mau', text: 'Chỉ 7 lệnh rơi vào khoảng này trên cả mẫu — chưa đủ để nói gì.' };
  }
  if (rewardR < 0.5) {
    return {
      verdict: 'it-mau',
      text: 'Nhìn rất đẹp (thắng 97%) nhưng chỉ 31 lệnh và dồn hết vào nửa sau mẫu — chưa đủ để tin.',
    };
  }
  return { verdict: 'duoc', text: 'Khoảng đo ra dương nhưng vừa phải — avgR 0.09–0.19.' };
}
