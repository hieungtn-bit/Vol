// ============================================================
// KỲ VỌNG CÓ XÁC SUẤT.
//
// Trước đây màn hình ghi "R kỳ vọng = 0.5×RR1 + 0.3×RR2". Con số đó KHÔNG phải
// kỳ vọng: nó giả định cả hai mốc chốt đều chạm, tức là một xác suất thắng bằng
// 100%. Nó cũng không khớp với chính bộ mô phỏng, vốn trả 0.5×R(TP1) + 0.5×R(TP2)
// — hai trọng số cộng lại 0.8 nghĩa là phần runner 20% bị bỏ rơi lặng lẽ. Vì thế
// ngưỡng cửa maxRRBlended = 1.5 đang được hiệu chuẩn trên một thang khác thang
// mà backtest thật sự chi trả.
//
// Ở đây thay bằng kỳ vọng thật: xác suất chạm nhân với tiền ăn được.
//
//   E = p1·[ p2·(0.5·rr1 + 0.5·rr2) + (1−p2)·(0.5·rr1 − 0.5) ] + (1−p1)·(−1)
//
// Ba nhánh đó đúng ba nhánh mà simulate() trả tiền: chạm cả hai mốc; chạm TP1 rồi
// quay về stop; không chạm gì rồi stop. Nhánh hết hạn giữ được gộp vào nhánh giữa
// theo phía xấu — hết hạn giữ trung bình tốt hơn quay về stop, nên tính như quay
// về stop là ước lượng thấp, không phải ước lượng cao.
//
// XÁC SUẤT ĐO THEO ĐỘ XA, KHÔNG THEO HẠNG. Đo trên 5460 lệnh (6 mã × 15m/1h/4h,
// 3000 nến mỗi cặp) cho thấy độ xa quyết định gần như toàn bộ tỉ lệ chạm, và
// bảng theo độ xa giữ nguyên hình dạng ở cả hai nửa mẫu; còn bảng theo hạng thì
// nửa sau lệch hẳn nửa đầu (hạng C: 46.8% → 56.2%). Chia theo hạng cũng sẽ tạo
// ra một lỗ hổng: kéo TP2 ra thật xa mà xác suất không đổi thì kỳ vọng tăng vô
// hạn — đúng cái bệnh cửa maxRRBlended phải chặn bằng tay.
// ============================================================

// ------------------------------------------------------------
// GIỚI HẠN ĐÃ ĐO ĐƯỢC CỦA MÔ HÌNH NÀY — đọc trước khi tin vào con số nó trả về.
//
// Đối chiếu kỳ vọng DỰ BÁO với R THỰC HIỆN trên 5460 lệnh
// (bench/expectancy-sweep.txt):
//
//   dự báo trong khoảng   n      dự báo   thực tế   p thắng dự báo / thực
//   [−1, −0.15)           2062   −0.249   −0.159    48% / 52%
//   [−0.15, −0.05)        1633   −0.101   −0.064    47% / 48%
//   [−0.05, 0.05)         1130   −0.006   −0.020    49% / 47%
//   [0.05, 0.15)           411   +0.092   −0.012    50% / 43%
//   [0.15, 0.30)           170   +0.200   −0.210    48% / 29%
//   [0.30, ∞)               38   +0.387   +0.183    46% / 37%
//
// Hai kết luận, cả hai đều phải nói ra chứ không được giấu:
//
// 1. Ở QUANH 0 mô hình bám khá sát, nên dùng nó làm ngưỡng "âm thì bỏ" là hợp lệ.
// 2. Ở PHÍA CAO mô hình LẠC QUAN CÓ HỆ THỐNG: dự báo càng cao thì thực tế càng
//    lệch xuống, tới mức ô [0.15, 0.30) thực ra là ô TỆ NHẤT. Nghĩa là con số này
//    KHÔNG dùng để xếp hạng kèo — "kỳ vọng +0.2R" không tốt hơn "+0.05R".
//
// Vì sao lệch: p(chạm TP1) đo theo độ xa là xác suất BIÊN. Độ xa không độc lập
// với chất lượng kèo — một kế hoạch có TP1 rất gần thường vì stop rộng bất
// thường, và những kèo đó không cùng phân phối với phần còn lại. Muốn sửa cho
// đúng thì phải ước lượng có điều kiện trên cả hoàn cảnh, không chỉ khoảng cách;
// mà muốn làm thế phải có mẫu lớn hơn nhiều.
//
// Cho tới lúc đó: dùng làm NHÃN (thay nhãn "R kỳ vọng" vốn sai hẳn) và làm
// NGƯỠNG ÂM/DƯƠNG. Không dùng để xếp hạng.
// ------------------------------------------------------------

/** Mép ô độ xa TP1, tính bằng R. */
export const RR1_EDGES = [0, 0.6, 1.0, 1.5, 2.5, Infinity];
/** Mép ô độ xa TP2, tính bằng R. */
export const RR2_EDGES = [0, 1.5, 2.5, 4.0, 6.0, Infinity];

/**
 * p(chạm TP1) theo ô độ xa TP1. Đo trên NỬA ĐẦU mẫu (2730 lệnh) để nửa sau còn
 * dùng kiểm tra được. Nửa sau: 75.4 / 56.7 / 44.0 / 37.4 / 21.3 — cùng hình dạng.
 *
 * Nguồn: scripts/hitrates.ts --tf 15m,1h,4h --bars 3000
 */
export const P_TP1 = [0.694, 0.549, 0.439, 0.352, 0.277];

/**
 * p(chạm TP2 | đã chạm TP1) theo ô độ xa TP2, cùng nguồn.
 *
 * Hai ô cuối KHÔNG phải số đo: nửa đầu chỉ có n=29 và n=4 lệnh rơi vào đó. Chúng
 * là ước lượng, đặt THẤP HƠN HẲN mức quan sát được (toàn mẫu: 52.8% và 42.9%),
 * theo đúng nguyên tắc không được trả tiền cho cái mình chưa đo được. Hệ quả cụ
 * thể: một kế hoạch kéo TP2 ra 6R+ gần như không thể qua cửa chỉ nhờ ngoại suy —
 * đó là điều mong muốn, vì trước đây kèo TP2 xa phải chặn bằng một ngưỡng cứng
 * đặt tay. `EXTRAPOLATED` đánh dấu đúng những ô đó để màn hình nói ra.
 */
export const P_TP2 = [0.882, 0.793, 0.765, 0.450, 0.200];
export const P_TP2_EXTRAPOLATED = [false, false, false, true, true];

/** Dùng khi không có rr — tỉ lệ chạm trung bình trên nửa đầu mẫu. */
export const P_TP1_DEFAULT = 0.513;
export const P_TP2_DEFAULT = 0.832;

function bucket(x: number, edges: number[]): number {
  for (let i = 0; i < edges.length - 1; i++) if (x >= edges[i] && x < edges[i + 1]) return i;
  return edges.length - 2;
}

export interface Expectancy {
  /** R kỳ vọng SAU phí. Đây là con số đáng nhìn. */
  net: number;
  /** R kỳ vọng trước phí. */
  gross: number;
  /** Phí quy ra R đã trừ. */
  feeR: number;
  /** p(chạm TP1) dùng trong phép tính. */
  pTP1: number;
  /** p(chạm TP2 | đã chạm TP1). */
  pTP2: number;
  /** Xác suất kết thúc có lãi = p1·p2 cộng phần p1 mà 0.5·rr1 đủ bù nửa lỗ. */
  pWin: number;
  /** Có ô nào phải ngoại suy thay vì đo không. */
  weak: boolean;
  /** Rơi vào vùng mà đối chiếu dự báo/thực tế cho thấy mô hình lạc quan quá. */
  optimistic: boolean;
  /** Câu ngắn hiện thẳng lên màn hình. */
  text: string;
}

/**
 * Kỳ vọng của một kế hoạch. `rr1`/`rr2` là khoảng cách TP tính bằng R (đã tính
 * từ đúng mép entry mà lệnh chờ sẽ khớp), `feeR` là phí vào-ra quy ra R.
 */
export function expectancy(rr1: number | null, rr2: number | null, feeR: number | null): Expectancy | null {
  if (rr1 == null || rr2 == null || !(rr1 > 0) || !(rr2 > 0)) return null;

  const b1 = bucket(rr1, RR1_EDGES);
  const b2 = bucket(rr2, RR2_EDGES);
  const p1 = P_TP1[b1] ?? P_TP1_DEFAULT;
  const p2 = P_TP2[b2] ?? P_TP2_DEFAULT;
  const weak = P_TP2_EXTRAPOLATED[b2] ?? true;

  // TP2 không thể gần hơn TP1 trong một kế hoạch hợp lệ; nếu có thì kế hoạch hỏng.
  if (rr2 < rr1) return null;

  const both = 0.5 * rr1 + 0.5 * rr2;   // đúng payout của simulate()
  const tp1Only = 0.5 * rr1 - 0.5;      // nửa còn lại quay về stop — phía xấu
  const gross = p1 * (p2 * both + (1 - p2) * tp1Only) + (1 - p1) * -1;
  const fee = feeR ?? 0;
  const net = gross - fee;

  // "Thắng" = kết thúc dương sau phí. Nhánh chạm cả hai luôn dương; nhánh chỉ
  // chạm TP1 dương khi 0.5·rr1 − 0.5 > phí.
  const tp1OnlyWins = tp1Only - fee > 0;
  const pWin = p1 * (p2 + (tp1OnlyWins ? 1 - p2 : 0));

  // Mô hình lạc quan có hệ thống ở phía cao (xem bảng đối chiếu ở đầu file), nên
  // ở đó phải nói ra thay vì để người đọc tưởng số càng cao kèo càng ngon.
  const optimistic = net > 0.15;

  const text =
    `${net >= 0 ? '+' : ''}${net.toFixed(2)}R kỳ vọng · thắng ${(pWin * 100).toFixed(0)}% ` +
    `(chạm TP1 ${(p1 * 100).toFixed(0)}%, rồi TP2 ${(p2 * 100).toFixed(0)}%)` +
    (weak ? ' · TP2 xa, xác suất là ước lượng chứ chưa đủ mẫu để đo' : '') +
    (optimistic ? ' · trên +0.15R mô hình đo ra là lạc quan quá — đừng đọc thành kèo ngon hơn' : '');

  return { net, gross, feeR: fee, pTP1: p1, pTP2: p2, pWin, weak, optimistic, text };
}
