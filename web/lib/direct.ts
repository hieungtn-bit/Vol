import { buildLongLevels, buildShortLevels, rr, type DecideInput, type Levels } from './decide';
import { expectancy, type Expectancy } from './expectancy';
import { fmtPrice } from './format';
import { OI_READ_VI } from './derivatives';
import { positioningSplit, type FlowInfo } from './flow';
import type { MarketStructure } from './structure';
import type { SizeHint, TF } from './types';

// ============================================================
// Engine LUÔN RA HƯỚNG.
//
// Khác hẳn decideBias(): ở đây không có WAIT. Mỗi symbol × mỗi khung luôn nhận
// một hướng LONG hoặc SHORT, kèm HẠNG TIN CẬY (A/B/C) nói thẳng kèo đó tốt hay
// tệ. Bỏ WAIT không có nghĩa là giả vờ mọi lúc đều có kèo đẹp — nó có nghĩa là
// luôn trả lời "nếu buộc phải chọn thì chọn bên nào", và nói rõ mức độ chắc.
//
// Hạng C = kèo yếu, chỉ nên coi là thiên hướng chứ không phải lệnh để vào tiền.
// ============================================================

/**
 * GOLD nằm TRÊN A: chỉ bật khi mọi vế bằng chứng có điểm đều chỉ cùng một hướng,
 * độ lệch đủ lớn, RR đủ và không dính cảnh báo nào. Nó hiếm — và phải hiếm, nếu
 * không thì nó chỉ là một cái nhãn A khác.
 */
export type Conviction = 'GOLD' | 'A' | 'B' | 'C';

/**
 * Ngưỡng hạng vàng — HIỆU CHUẨN BẰNG BACKTEST, không phải đặt bằng cảm tính.
 *
 * Bản đầu đòi thêm RR TP2 ≥ 2, R kỳ vọng ≥ 1 và không cảnh báo nào. Trên 1831 tín
 * hiệu thật, bộ điều kiện đó bắn ĐÚNG 0 lần — code chết. Tệ hơn, đo lại thì hai điều
 * kiện đó chọn ngược:
 *   - nhóm "R kỳ vọng ≥ 1.5" cho avgR −0.03 (PF 0.95), trong khi nhóm 0.5–1 cho 0.24.
 *     Mục tiêu càng xa thì càng ít khi chạm tới, và SL thì vẫn ở đó.
 *   - nhóm "0 cảnh báo" cho avgR 0.14, nhóm "≥2 cảnh báo" cho 0.21.
 * Nên cả hai đã bị bỏ khỏi điều kiện.
 *
 * Còn lại là hai điều kiện có edge đo được: độ lệch lớn và mọi vế nhất trí.
 *   net≥30            n=243  avgR 0.32  PF 2.33
 *   net≥30 + nhất trí n=168  avgR 0.31  PF 2.27
 *   net≥40 + nhất trí n=104  avgR 0.36  PF 2.50  ← chọn cái này
 */
export const GOLD = {
  /** |net| tối thiểu. 40 đo ra tốt hơn 30 một cách rõ ràng. */
  minNet: 40,
  /**
   * Số vế thực sự có điểm, để "nhất trí" không bị tuyên bố khi hầu hết vế đang câm.
   *
   * Đặt 3 chứ không phải 4. Ngưỡng 4 nghe chặt hơn nhưng khi phái sinh N/A (chỉ còn
   * 4 vế khả dụng) nó hoá ra đòi TOÀN BỘ vế phải lên tiếng, và đo được là ràng buộc
   * đó chọn xấu đi: net≥40 + nhất trí cho n=104 avgR 0.36, thêm "≥4 vế" còn n=61
   * avgR 0.23. Với net ≥ 40 thì bản thân ngưỡng điểm đã đòi vài vế mạnh rồi.
   */
  minContributing: 3,
  /** Dưới ngưỡng này coi như nhiễu, không tính là "ngược hướng". */
  noiseFloor: 1,
};

/**
 * Cửa chất lượng — ngưỡng do backtest hiệu chuẩn, không phải chọn tay.
 * Xem mục 11 của ALGORITHM.md.
 */
/**
 * Phí giả định để quy ra R. Taker Binance perp, vào một lần ra một lần, cộng
 * trượt giá khi thoát bằng stop. Đúng bộ số backtest đang dùng.
 */
export const FEES = { perSide: 0.0005, slip: 0.0002 };

/** Phí quy ra R cho một stop rộng `risk` trên giá `entry`. */
export function feeInR(entry: number, risk: number): number | null {
  if (!(entry > 0) || !(risk > 0)) return null;
  return ((FEES.perSide * 2 + FEES.slip) * entry) / risk;
}

/**
 * Ngưỡng đọc lịch sử funding. Đặt bằng lập luận, KHÔNG bằng đo — backtest chạy mù
 * phái sinh nên chưa kiểm chứng được vế này. Vì thế các hệ số đều nhỏ và lấy từ
 * ngân sách của chính vế funding, không cộng thêm trọng số mới.
 */
export const FUNDING_HIST = {
  /** Chuỗi trước cú đảo phải dài ít nhất bấy nhiêu kỳ mới coi là sự kiện. */
  minStreak: 4,
  /** Chuỗi chưa đảo dài tới mức này thì coi là bên trả tiền đã mỏi. */
  longStreak: 8,
  /** Phần trọng số funding dành cho cú đảo. */
  flipShare: 0.5,
  /** Phần trọng số funding dành cho chuỗi dài chưa đảo. */
  tiredShare: 0.25,
};

export const GATE = {
  /**
   * Kỳ vọng SAU PHÍ tối thiểu, tính bằng R. Xem lib/expectancy.ts.
   *
   * Thay cho ngưỡng maxRRBlended = 1.5 cũ. Ngưỡng cũ hỏng theo hai cách: nó đo
   * trên thang 0.5×RR1 + 0.3×RR2 mà bộ mô phỏng lại trả 0.5/0.5, và nó chặn TP2
   * xa bằng một con số chặn cứng thay vì bằng xác suất chạm. Ngưỡng mới nói đúng
   * điều cần nói: kèo này, với tỉ lệ chạm ĐO ĐƯỢC ở đúng khoảng cách đó, có ăn
   * nổi phí không.
   *
   * Giá trị lấy từ scripts/expsweep.ts — xem bench/expectancy-sweep.txt.
   */
  minExpectancy: 0,
  // Vì sao đúng 0 chứ không phải mức "đẹp nhất" trên đường cong: sweep (6 mã ×
  // 15m/1h/4h, 5460 lệnh, bench/expectancy-sweep.txt) cho thấy ngưỡng 0 kéo PF
  // 0.84 → 0.97 toàn mẫu và 0.78 → 0.91 ngoài mẫu, còn MỌI ngưỡng cao hơn đều
  // TỆ ĐI: ≥0.15 cho PF 0.75, ≥0.2 cho 0.73. Ô ≥0.3 nhìn đẹp ở nửa đầu (PF 1.82,
  // n=25) và sập ở nửa sau (0.73) — đúng hình dạng của uốn tham số.
  //
  // 0 cũng là mức DUY NHẤT có lý do cơ học chứ không phải lý do thống kê: dưới 0
  // là kèo mà chính bảng xác suất của mình nói là lỗ.
  //
  /** Trên mức này thì TP2 xa quá so với stop — cảnh báo, không phải cửa. */
  maxRewardRatio: 2.5,
  /**
   * Phí không được ăn quá bấy nhiêu phần của 1R.
   *
   * Đây là điều kiện quan trọng nhất và cũng phản trực giác nhất mà backtest tìm
   * ra. Tách gộp/ròng theo độ rộng stop trên 5661 lệnh:
   *
   *   stop 0–0.5%  → R gộp 0.01, phí 0.394 → ròng −0.39
   *   stop 0.5–1%  → R gộp 0.17, phí 0.141 → ròng  0.03
   *   stop 1–1.5%  → R gộp 0.17, phí 0.092 → ròng  0.08
   *   stop 1.5–2%  → R gộp 0.18, phí 0.065 → ròng  0.12
   *   stop 2–3%    → R gộp 0.33, phí 0.046 → ròng  0.28
   *
   * R GỘP gần như bằng nhau ở mọi độ rộng — chất lượng kèo không đổi. Toàn bộ
   * chênh lệch là phí, vì phí tính theo R tỉ lệ NGHỊCH với độ rộng stop. Một kèo
   * stop 0.5% phải thắng thêm 0.39R chỉ để hoà phí, trong khi cả cái edge đo được
   * chỉ có 0.17R. Đây là sự thật cơ học, không phải chế độ thị trường: nó còn
   * đúng chừng nào còn trả phí taker.
   *
   * Ngưỡng 0.10 ứng với stop ≈ 1.2% giá. Đo được 1.5% cho kết quả ngoài mẫu tốt
   * hơn (0.15 vs 0.11), nhưng ngồi lên đúng đỉnh của một đường cong đo trên
   * n=599 là uốn tham số — nên lấy mức có lý do cơ học thay vì mức đẹp nhất.
   */
  maxFeeShare: 0.1,
};

export interface Evidence {
  label: string;
  /** Bằng chứng này nghiêng về đâu. */
  side: 'long' | 'short' | 'neutral';
  /** Điểm đã ký: dương = ủng hộ long, âm = ủng hộ short. */
  points: number;
  detail: string;
}

export interface DirectionalCall {
  symbol: string;
  tf: TF;
  side: 'LONG' | 'SHORT';
  conviction: Conviction;
  /** true khi đạt hạng vàng. */
  golden: boolean;
  /** Nếu chưa đạt hạng vàng thì còn thiếu đúng những gì. Rỗng nghĩa là đã đạt. */
  goldenBlockers: string[];
  /** Không vế chấm điểm nào (trên mức nhiễu) chống lại hướng đã chọn. */
  unanimous: boolean;
  /** Tên các vế đang chống lại hướng đã chọn. Rỗng khi nhất trí. */
  contestedBy: string[];
  /**
   * Qua CỬA CHẤT LƯỢNG đo được bằng backtest. Vẫn luôn có hướng — cửa này chỉ
   * nói "đáng đặt tiền" hay "chỉ theo dõi", không bao giờ biến thành WAIT.
   */
  tradeable: boolean;
  /** Nếu chưa qua cửa thì vì đúng những gì. Rỗng nghĩa là đã qua. */
  gateBlockers: string[];
  /** -100 (short rõ) .. +100 (long rõ). */
  net: number;
  longScore: number;
  shortScore: number;
  entry: [number, number];
  sl: number;
  tp1: number;
  tp2: number;
  rr1: number | null;
  rr2: number | null;
  /**
   * TỶ LỆ LỜI/LỖ CỦA KẾ HOẠCH — không phải kỳ vọng. Là số R ăn được NẾU cả hai
   * mốc chốt đều chạm: 0.5×RR1 + 0.5×RR2, đúng bằng payout mà simulate() trả.
   * (Trước đây trọng số là 0.5/0.3 — cộng lại 0.8, tức phần runner 20% bị bỏ
   * rơi lặng lẽ, nên màn hình và bộ mô phỏng đang nói hai thang khác nhau.)
   */
  rewardRatio: number | null;
  /** Kỳ vọng THẬT, có xác suất chạm đo từ backtest. Xem lib/expectancy.ts. */
  expectancy: Expectancy | null;
  runner: string | null;
  size: SizeHint;
  trigger: string;
  invalidation: string;
  evidence: Evidence[];
  structureNote: string;
  flowNote: string;
  fundingText: string;
  buyPctPerp: number | null;
  buyPctSpot: number | null;
  warnings: string[];
  planText: string;
}

/**
 * Trọng số các vế chấm điểm. Tổng luôn giữ ở 103 để ngưỡng hạng (net ≥ 30 = A,
 * ≥ 15 = B) còn so sánh được giữa các bộ trọng số khác nhau.
 */
export interface Weights {
  structure: number;
  valueLocation: number;
  takerFlow: number;
  priceAction: number;
  openInterest: number;
  funding: number;
}

export const W: Weights = {
  structure: 25,
  valueLocation: 20,
  takerFlow: 20,
  priceAction: 18,
  openInterest: 12,
  funding: 8,
};

const TRIG: Record<TF, string> = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D' };

export function decideDirection(
  inp: DecideInput,
  structure: MarketStructure,
  flow: FlowInfo,
  weights: Weights = W,
): DirectionalCall {
  const { vp, pa, last, tf, symbol } = inp;
  const W = weights;   // che biến module để phần thân bên dưới không phải sửa
  const P = (x: number | null) => fmtPrice(x, vp.binSize);
  const ev: Evidence[] = [];

  const push = (label: string, points: number, detail: string) => {
    ev.push({
      label,
      side: points > 0.5 ? 'long' : points < -0.5 ? 'short' : 'neutral',
      points: Math.round(points * 10) / 10,
      detail,
    });
  };

  // 1. Cấu trúc HH/HL/LL/LH
  push('Cấu trúc HH/HL/LH/LL', (structure.bias / 100) * W.structure, structure.note);

  // 2. Vị trí so với value — CÓ ĐIỀU KIỆN CHẤP NHẬN.
  //
  // Bản đầu mã hoá "chạm VAH thì fade xuống" một cách vô điều kiện. Backtest 1181
  // lệnh nói vế đó có edge ÂM (-0.24): khi nó ủng hộ hướng đã vào thì avgR -0.01,
  // khi nó chống lại thì avgR +0.23. Tức giả định fade vô điều kiện là sai.
  //
  // Lý thuyết market profile vốn đã nói khác: giá được CHẤP NHẬN ngoài value nghĩa
  // là value đang dịch chuyển — đi tiếp, không phải hồi. Chỉ khi bị TỪ CHỐI (ló ra
  // rồi đóng lại vào trong) mới là fade.
  //
  // Chấp nhận ở đây đo bằng chính VA (hai nến đóng liên tiếp cùng phía ngoài), KHÔNG
  // mượn accept/grab của PA — vế PA đã chấm cái đó rồi, mượn lại là chấm hai lần.
  const closedBars = inp.candles.filter((c) => c.closed);
  const lastBar = closedBars[closedBars.length - 1];
  const prevClose = closedBars.length >= 2 ? closedBars[closedBars.length - 2].c : null;

  const vaW = vp.va70.high - vp.va70.low;
  let locPts = 0;
  let locNote: string;
  if (vaW > 0) {
    const pos = (last - vp.va70.low) / vaW;        // 0 = VAL, 1 = VAH
    const centered = Math.max(-1, Math.min(1, (0.5 - pos) * 2));
    const outUp = last > vp.va70.high;
    const outDn = last < vp.va70.low;
    const heldUp = outUp && prevClose != null && prevClose > vp.va70.high;
    const heldDn = outDn && prevClose != null && prevClose < vp.va70.low;

    if (heldUp) {
      locPts = W.valueLocation;
      locNote = `hai nến liền đóng trên VAH ${P(vp.va70.high)} — value đang dịch lên, đi theo`;
    } else if (heldDn) {
      locPts = -W.valueLocation;
      locNote = `hai nến liền đóng dưới VAL ${P(vp.va70.low)} — value đang dịch xuống, đi theo`;
    } else if (outUp) {
      locPts = -W.valueLocation * 0.5;
      locNote = `lần đầu đóng trên VAH ${P(vp.va70.high)} — chưa được chấp nhận, nghiêng về hồi lại value`;
    } else if (outDn) {
      locPts = W.valueLocation * 0.5;
      locNote = `lần đầu đóng dưới VAL ${P(vp.va70.low)} — chưa được chấp nhận, nghiêng về hồi lại value`;
    } else {
      locPts = centered * W.valueLocation * 0.5;
      locNote = `trong value, ở ${(pos * 100).toFixed(0)}% bề rộng (${P(vp.va70.low)}–${P(vp.va70.high)}), POC ${P(vp.poc)}`;
    }
  } else {
    locNote = 'VA quá hẹp để định vị.';
  }
  push('Vị trí trong Value Area', locPts, locNote);

  // 3. Taker flow — ai đang chủ động đánh
  let flowPts = 0;
  const combinedBuy = flow.perpTaker?.buyPct ?? flow.spotTaker?.buyPct ?? null;
  if (combinedBuy != null) {
    flowPts = ((combinedBuy - 50) / 50) * W.takerFlow;
    if (flow.agree) flowPts *= 1.15;               // perp và spot đồng thuận thì tin hơn
  }
  push('Taker Buy/Sell', flowPts, flow.note);

  // 4. Price action của cây đã đóng
  let paPts = 0;
  const paBits: string[] = [];
  if (lastBar) {
    const green = lastBar.c > lastBar.o;
    paPts += (green ? 1 : -1) * W.priceAction * 0.4;
    paBits.push(`nến ${TRIG[tf]} cuối đóng ${green ? 'xanh' : 'đỏ'}`);
  }
  if (pa.acceptedOutside === 'up') { paPts += W.priceAction * 0.6; paBits.push('close giữ ngoài range phía trên = accept'); }
  if (pa.acceptedOutside === 'down') { paPts -= W.priceAction * 0.6; paBits.push('close giữ ngoài range phía dưới = accept'); }
  if (pa.grab === 'up') { paPts -= W.priceAction * 0.4; paBits.push('wick lên rồi đóng trong = grab thanh khoản, không phải break'); }
  if (pa.grab === 'down') { paPts += W.priceAction * 0.4; paBits.push('wick xuống rồi đóng trong = grab thanh khoản, không phải break'); }
  if (pa.signalHasVolume) {
    if (pa.signal === 'pin-bull' || pa.signal === 'engulf-bull') { paPts += W.priceAction * 0.4; paBits.push(`${pa.signal} có volume`); }
    if (pa.signal === 'pin-bear' || pa.signal === 'engulf-bear') { paPts -= W.priceAction * 0.4; paBits.push(`${pa.signal} có volume`); }
  }
  // Volume KHÔNG tự chấm hướng. Nếu nó cũng cộng/trừ theo hướng cây cuối thì cùng
  // một cây nến bị tính hai lần (một lần ở PA, một lần ở đây) và một cây 15m đơn lẻ
  // nặng bằng cả OI. Ở đây volume chỉ NHÂN vào độ tin của PA.
  let volMult = 1;
  let volNote = 'volume không đáng chú ý';
  if (pa.volMedian20 > 0) {
    const ratio = pa.lastVol / pa.volMedian20;
    if (ratio >= 1.5) { volMult = 1.4; volNote = `volume cây cuối gấp ${ratio.toFixed(2)}× median 20 — xác nhận mạnh (PA ×1.4)`; }
    else if (ratio < 0.6) { volMult = 0.5; volNote = `volume teo (${ratio.toFixed(2)}× median) — mọi tín hiệu nến ở đây đều yếu (PA ×0.5)`; }
    else volNote = `volume ${ratio.toFixed(2)}× median — bình thường (PA ×1)`;
  }
  paPts *= volMult;

  push('Price Action', paPts, paBits.join(' · ') || 'không có tín hiệu nến rõ');

  // 5. Open Interest
  const oi = inp.deriv.oi;
  let oiPts = 0;
  if (oi.quality === 'REAL' && oi.read !== 'na' && oi.read !== 'flat') {
    const map: Record<string, number> = {
      'new-longs': 1, 'short-cover': 0.6, 'new-shorts': -1, 'long-cover': -0.6,
    };
    oiPts = (map[oi.read] ?? 0) * W.openInterest;
  }
  push('Open Interest', oiPts, oi.read === 'na' ? 'N/A — không tính điểm' : OI_READ_VI[oi.read]);

  // 6. Volume đã được tính vào PA ở trên dưới dạng hệ số nhân. Vẫn in ra thành một
  //    dòng để người đọc thấy vì sao PA nặng hay nhẹ, nhưng điểm riêng của nó là 0.
  push('Volume (hệ số cho PA)', 0, volNote);

  // 7. Funding — ai đang trả ai.
  //    Mức thường: bên trả tiền là bên đông, đi cùng xu hướng, tính điểm nhẹ theo chiều đó.
  //    Mức cực đoan: đám đông quá lệch thành nhiên liệu cho cú ép ngược — đảo dấu.
  let fundPts = 0;
  const fnd = inp.deriv.funding;
  if (fnd.quality === 'REAL' && !fnd.flat && fnd.rate != null) {
    const dir = fnd.rate > 0 ? 1 : -1;             // dương = đám đông đứng long
    fundPts = fnd.extreme ? -dir * W.funding : dir * W.funding * 0.4;
  }
  push('Funding (ai trả ai)', fundPts, flow.funding.text);

  // 7b. LỊCH SỬ funding — đã kéo dài bao lâu, và vừa đảo chưa.
  //
  //     Rate hiện tại nói ai đang trả ai LÚC NÀY. Nó không nói được một chuỗi sáu
  //     kỳ long trả short vừa lật thành short trả long — mà đó mới là sự kiện.
  //     Chuỗi càng dài, bên trả tiền càng đông và càng mỏi; cú đảo sau một chuỗi
  //     dài là dấu hiệu bên đó bắt đầu bỏ chạy.
  //
  //     CẢNH BÁO: vế này CHƯA TỪNG được backtest kiểm chứng, vì backtest chạy mù
  //     phái sinh (fapi chặn IP). Nên nó KHÔNG được cấp thêm trọng số — nó chỉ
  //     chia lại phần ngân sách của chính vế funding. Tổng trọng số không đổi, và
  //     một vế chưa đo được thì không được phép làm nặng thêm kết luận.
  let histPts = 0;
  const fh = fnd.history;
  if (fh && fh.flipped && fh.brokeStreak >= FUNDING_HIST.minStreak) {
    // Đảo sau chuỗi dài: nghiêng về phía bên VỪA THÀNH bên trả tiền phải chịu ép.
    // streakSign 1 = long trả short → đám đông vừa lật sang long → điểm âm.
    histPts = -fh.streakSign * W.funding * FUNDING_HIST.flipShare;
  } else if (fh && !fh.flipped && fh.streak >= FUNDING_HIST.longStreak && fh.streakSign !== 0) {
    // Chuỗi rất dài mà chưa đảo: bên trả tiền đã mỏi, rủi ro ép ngược tăng dần.
    histPts = -fh.streakSign * W.funding * FUNDING_HIST.tiredShare;
  }
  if (fh) {
    push('Lịch sử funding (chuỗi / đảo chiều)', histPts, `${fh.text} · chưa qua backtest`);
  }

  const split = positioningSplit(flow.positioning);
  if (split) push('Thế đứng lẻ vs lớn', 0, split);

  // ---- Tổng hợp ----
  const net = Math.max(-100, Math.min(100, ev.reduce((s, e) => s + e.points, 0)));
  const longScore = Math.round(50 + net / 2);
  const shortScore = 100 - longScore;
  const side: 'LONG' | 'SHORT' = net >= 0 ? 'LONG' : 'SHORT';
  const mag = Math.abs(net);
  let conviction: Conviction = mag >= 30 ? 'A' : mag >= 15 ? 'B' : 'C';

  const lv: Levels = side === 'LONG' ? buildLongLevels(inp) : buildShortLevels(inp);
  const entryRef = side === 'LONG' ? lv.entry[1] : lv.entry[0];
  const rr1 = rr(entryRef, lv.sl, lv.tp1);
  const rr2 = rr(entryRef, lv.sl, lv.tp2);
  const slPct = (Math.abs(entryRef - lv.sl) / last) * 100;
  const feeR = feeInR(entryRef, Math.abs(entryRef - lv.sl));
  // Tỷ lệ lời/lỗ của kế hoạch, trọng số 0.5/0.5 để khớp đúng payout của
  // simulate(). Đây KHÔNG phải kỳ vọng — nó giả định cả hai mốc đều chạm.
  const rewardRatio = rr1 != null && rr2 != null ? 0.5 * rr1 + 0.5 * rr2 : null;
  // Kỳ vọng thật: nhân với xác suất chạm đo được, rồi trừ phí.
  const exp = expectancy(rr1, rr2, feeR);

  const warnings: string[] = [];
  if (conviction === 'C') {
    warnings.push('Hạng C — bằng chứng hai phía gần cân nhau. Đây là thiên hướng, không phải kèo để vào tiền lớn.');
  }
  if (exp != null && exp.net < 0) {
    warnings.push(
      `Kỳ vọng ÂM ${exp.net.toFixed(2)}R sau phí — xác suất chạm không bù nổi khoảng cách. ` +
      `Chạm TP1 ${(exp.pTP1 * 100).toFixed(0)}%, rồi TP2 ${(exp.pTP2 * 100).toFixed(0)}%.`,
    );
  }
  if (exp != null && exp.weak) {
    warnings.push(
      'TP2 xa tới vùng mà backtest chưa đủ mẫu để đo tỉ lệ chạm — xác suất dùng ở đây ' +
      'là ước lượng thấp, không phải số đo.',
    );
  }
  if (feeR != null && feeR > GATE.maxFeeShare) {
    warnings.push(
      `Stop chỉ ${slPct.toFixed(2)}% giá — phí vào-ra ăn mất ${(feeR * 100).toFixed(0)}% của 1R. ` +
      'Backtest: R gộp không đổi theo độ rộng stop, nhưng nhóm stop dưới 0.5% giá ' +
      'ròng −0.39R chỉ vì phí.',
    );
  }
  // "SL rộng quá 3% giá" từng là cảnh báo. Backtest nói ngược: nhóm 2–3% là nhóm
  // TỐT NHẤT (avgR 0.28) còn nhóm 0–1% mới âm. Giữ lại nhắc về đòn bẩy, bỏ hàm ý
  // rằng stop rộng là kèo xấu.
  if (slPct > 3) {
    warnings.push(
      `SL cách entry ${slPct.toFixed(2)}% — tự nó không phải kèo xấu (backtest: nhóm ` +
      'stop rộng cho R ròng cao hơn), nhưng isolated đòn bẩy cao ở đây là cháy. Hạ size.',
    );
  }
  if (!lv.tp1InVA) warnings.push('TP1 nằm ngoài VA — đã kéo về mép value gần nhất.');
  if (lv.crossings >= 3) warnings.push(`Đoạn TP1→TP2 xuyên ${lv.crossings} HVN — phần cuối chạy như runner.`);
  if (rewardRatio != null && rewardRatio > GATE.maxRewardRatio) {
    warnings.push(
      `Tỷ lệ lời/lỗ kế hoạch ${rewardRatio.toFixed(2)} — TP2 xa tới mức backtest đo ra vùng LỖ. ` +
      'Chốt sạch ở TP1 hoặc bỏ kèo.',
    );
  }
  if (inp.deriv.oi.squeezeWarning) warnings.push('OI/vol perp cao bất thường — rủi ro squeeze hai chiều.');
  if (structure.state === 'uptrend' && side === 'SHORT') {
    warnings.push('Ngược cấu trúc HH+HL — short ở đây là counter-trend, chốt TP1 bắt buộc.');
  }
  if (structure.state === 'downtrend' && side === 'LONG') {
    warnings.push('Ngược cấu trúc LH+LL — long ở đây là counter-trend, chốt TP1 bắt buộc.');
  }

  // ---- Hạng vàng ----
  // Xét SAU khi đã có mức giá và cảnh báo, vì RR và cảnh báo cũng là điều kiện.
  const wantLong = side === 'LONG';
  const contributing = ev.filter((e) => Math.abs(e.points) >= GOLD.noiseFloor);
  const against = contributing.filter((e) => (wantLong ? e.points < 0 : e.points > 0));

  const goldenBlockers: string[] = [];
  if (against.length > 0) {
    goldenBlockers.push(
      `${against.length} vế ngược hướng: ${against.map((e) => e.label).join(', ')}`,
    );
  }
  if (contributing.length < GOLD.minContributing) {
    goldenBlockers.push(
      `chỉ ${contributing.length} vế có điểm (cần ≥ ${GOLD.minContributing}) — phần còn lại N/A hoặc trung tính`,
    );
  }
  if (mag < GOLD.minNet) {
    goldenBlockers.push(`độ lệch ${mag.toFixed(0)} (cần ≥ ${GOLD.minNet})`);
  }
  // Không còn điều kiện RR và điều kiện "không cảnh báo": backtest cho thấy cả hai
  // chọn ngược. Cảnh báo vẫn được in ra để người đọc tự cân, chỉ là không dùng để
  // chặn hạng vàng nữa.

  const golden = goldenBlockers.length === 0;
  if (golden) conviction = 'GOLD';

  // ---- CỬA CHẤT LƯỢNG ----
  //
  // ĐỌC KỸ TRƯỚC KHI TIN VÀO CỬA NÀY.
  //
  // Chỗ này từng ghi: "lọc bằng ba điều kiện giữ 22% số lệnh nhưng nâng avgR
  // 0.05 → 0.18, PF 1.13 → 1.61". Những con số đó đo bằng một bộ mô phỏng có hai
  // lỗi (khớp ở giá nến chưa in ra, và tính chốt lời ngay trên nến vào lệnh). Sau
  // khi sửa, đo lại ĐÚNG cùng dữ liệu — 5280 lệnh, 6 mã × 15m/1h/4h, 3000 nến:
  //
  //   không cửa nào          avgR −0.08   PF 0.84   (ngoài mẫu PF 0.78)
  //   cửa cũ                 avgR −0.06   PF 0.89   (ngoài mẫu PF 0.84)
  //   cửa đầy đủ 4 điều kiện avgR −0.02   PF 0.96   (ngoài mẫu PF 0.95)
  //   + siết stop ≥ 1.5%     avgR −0.02   PF 0.96   (ngoài mẫu PF 1.00)
  //
  // Nghĩa là: cửa VẪN lọc đúng chiều — mỗi điều kiện thêm vào đều kéo PF lên, và
  // kéo lên trên cả nửa mẫu ngoài. Nhưng nó kéo từ LỖ về HOÀ, không kéo lên lãi.
  // Trên mẫu rộng này hệ chưa có lợi thế đo được. Chi tiết: bench/full-sau-sua.txt.
  //
  // Vì vậy cửa ở đây giữ nguyên vai trò "lọc bớt kèo tệ", KHÔNG được đọc thành
  // "kèo qua cửa là kèo có lãi kỳ vọng".
  const unanimous = against.length === 0;
  const contestedBy = against.map((e) => e.label);

  const gateBlockers: string[] = [];
  if (!unanimous) gateBlockers.push(`${against.length} vế ngược hướng: ${contestedBy.join(', ')}`);
  if (conviction === 'C') gateBlockers.push(`độ lệch ${mag.toFixed(0)} — dưới hạng B (cần ≥ 15)`);
  if (exp != null && exp.net < GATE.minExpectancy) {
    gateBlockers.push(
      `kỳ vọng ${exp.net >= 0 ? '+' : ''}${exp.net.toFixed(2)}R sau phí — dưới ${GATE.minExpectancy}R`,
    );
  }
  if (!inp.hasClosedBar) {
    // Engine "luôn ra hướng" trước đây KHÔNG hề kiểm tra điều này, trong khi
    // decideBias() chặn ở ba chỗ. Hướng vẫn hiện, nhưng nó không phải kèo để
    // đặt tiền: mọi mức entry/SL/TP đang dựng trên một nến chưa chốt.
    gateBlockers.push(`chưa có nến ${TRIG[tf]} đóng của chu kỳ vừa xong — dữ liệu cũ`);
  }
  if (feeR != null && feeR > GATE.maxFeeShare) {
    gateBlockers.push(
      `phí ăn ${(feeR * 100).toFixed(0)}% của 1R (stop chỉ ${slPct.toFixed(2)}% giá) — ` +
      `quá ${(GATE.maxFeeShare * 100).toFixed(0)}%`,
    );
  }
  const tradeable = gateBlockers.length === 0;

  // Size đi theo CỬA, không theo số cảnh báo. Backtest cho thấy số cảnh báo gần
  // như không phân loại được gì (0 cảnh báo avgR 0.10, 1 cảnh báo 0.04, ≥2 là
  // 0.05 — không đơn điệu), còn cửa thì phân loại rất rõ.
  const size: SizeHint = !tradeable ? 'Small' : conviction === 'GOLD' || conviction === 'A' ? 'Normal' : 'Small';

  const trigger = side === 'LONG'
    ? `${TRIG[tf]} đóng trên ${P(Math.max(vp.va70.low, lv.entry[1]))} sau khi giữ ${P(lv.entry[0])}`
    : `${TRIG[tf]} đóng dưới ${P(Math.min(vp.va70.high, lv.entry[0]))} sau khi test ${P(lv.entry[1])}`;

  const invalidation = structure.breakLevel != null
    ? `đóng nến ${TRIG[tf]} ${side === 'LONG' ? 'dưới' : 'trên'} ${P(lv.sl)} thì hủy; cấu trúc gãy hẳn khi đóng ${structure.state === 'uptrend' ? 'dưới' : 'trên'} ${P(structure.breakLevel)}`
    : `đóng nến ${TRIG[tf]} ${side === 'LONG' ? 'dưới' : 'trên'} ${P(lv.sl)} thì hủy`;

  const call: DirectionalCall = {
    symbol, tf, side, conviction, golden, goldenBlockers, net,
    unanimous, contestedBy, tradeable, gateBlockers,
    longScore, shortScore,
    entry: lv.entry, sl: lv.sl, tp1: lv.tp1, tp2: lv.tp2,
    rr1, rr2, rewardRatio, expectancy: exp, runner: lv.runner, size, trigger, invalidation,
    evidence: ev,
    structureNote: structure.note,
    flowNote: flow.note,
    fundingText: flow.funding.text,
    buyPctPerp: flow.perpTaker?.buyPct ?? null,
    buyPctSpot: flow.spotTaker?.buyPct ?? null,
    warnings,
    planText: '',
  };
  call.planText = buildDirectPlan(call);
  return call;
}

export function buildDirectPlan(c: DirectionalCall): string {
  const P = (x: number | null) => (x == null ? 'N/A' : String(x));
  const L: string[] = [];
  L.push(
    `[${c.symbol}] [${c.tf}] [${c.side}] ${c.golden ? '★ TÍN HIỆU VÀNG' : `hạng ${c.conviction}`}` +
    ` · long ${c.longScore} / short ${c.shortScore}`,
  );
  L.push(`Entry: ${c.entry[0]} – ${c.entry[1]}`);
  L.push(`Trigger đóng: ${c.trigger}`);
  L.push(`SL: ${c.sl}`);
  L.push(`TP1: ${c.tp1} gỡ 50%${c.rr1 != null ? ` · RR ${c.rr1.toFixed(2)}` : ''}`);
  L.push(`TP2: ${c.tp2} gỡ 30%${c.rr2 != null ? ` · RR ${c.rr2.toFixed(2)}` : ''}`);
  if (c.rewardRatio != null) L.push(`Tỷ lệ lời/lỗ nếu chạm cả hai mốc: ${c.rewardRatio.toFixed(2)}`);
  if (c.expectancy != null) L.push(`Kỳ vọng sau phí: ${c.expectancy.text}`);
  L.push(`Runner: ${c.runner ?? 'không mở'}`);
  L.push(`Hủy: ${c.invalidation}`);
  L.push(`Size: ${c.size} · rủi ro 0.5–1% tài khoản`);
  L.push(`Cấu trúc: ${c.structureNote}`);
  L.push(`Dòng tiền: ${c.flowNote}`);
  L.push(`Funding: ${c.fundingText}`);
  L.push('Bằng chứng:');
  for (const e of c.evidence) {
    const sign = e.points > 0 ? '+' : '';
    L.push(`  ${sign}${e.points} ${e.label}: ${e.detail}`);
  }
  if (c.warnings.length) {
    L.push('Cảnh báo:');
    for (const w of c.warnings) L.push(`  ! ${w}`);
  }
  if (!c.golden) {
    L.push(`Chưa đạt tín hiệu vàng vì: ${c.goldenBlockers.join(' · ')}`);
  }
  L.push('Cấm: market giữa VA, TP xuyên nhiều HVN, add sau lỗ.');
  return L.join('\n');
}
