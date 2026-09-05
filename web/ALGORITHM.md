# Thuật toán Market Scan — tài liệu đầy đủ

Đây là tài liệu **chuẩn** của thuật toán. `logic.md` là bản tóm một trang; khi hai bên
lệch nhau thì tin file này, và sửa file kia.

Mọi ngưỡng trong tài liệu đọc thẳng từ mã nguồn tại thời điểm viết. Bảng hằng số ở
mục 11 là chỗ duy nhất liệt kê con số — các mục trên chỉ giải thích *vì sao*.

---

## 1. Hai đường kết luận, một bộ dữ liệu

Hệ chạy **một** bộ phân tích rồi cho nó đi qua **hai** bước kết luận khác nhau:

| | Câu hỏi nó trả lời | WAIT? | Màn hình |
|---|---|---|---|
| **Kỷ luật** (`decideBias`) | "Có kèo đáng vào không?" | có, và thường xuyên | `/strict` |
| **Luôn ra hướng** (`decideDirection`) | "Nếu buộc phải chọn thì chọn bên nào?" | không bao giờ | `/` |

Cả hai đi qua cùng `prepareTF()` nên không thể lệch dữ liệu. Backtest cũng dùng chính
hàm đó — nếu không, nó kiểm chứng một hệ khác với hệ đang chạy.

Mỗi symbol × mỗi khung (15m / 1h / 4h / 1D) là **một quyết định độc lập**. 15m Long
không biến thành 1D Long.

---

## 2. Dữ liệu và chất lượng

| Dữ liệu | Nguồn | Khi hỏng |
|---|---|---|
| Klines, ticker 24h | `data-api.binance.vision` | fallback `api.binance.com` |
| Taker delta **spot** | field *taker buy base* của kline — số thật | không có → suy từ hướng đóng nến, gắn nhãn `PROXY` |
| Taker **perp**, OI, funding | `fapi.binance.com` | 451/403 → `N/A`, funding/OI rơi sang OKX public |

Ba nhãn chất lượng: `REAL` · `PROXY` · `UNAVAILABLE`.

**Luật cứng về dữ liệu thiếu:** trường `UNAVAILABLE` **không được cộng điểm** và
**không được xuất hiện trong danh sách lý do**. Nó chỉ được ghi `N/A`.

**Luật cứng về trộn chợ:** taker perp và taker spot là hai thị trường khác nhau, luôn
hiển thị tách rời. Chỉ khi cả hai cùng nghiêng một phía mới ghi "đồng thuận". Tỷ lệ
OI/volume cũng phải cùng một chợ — không có volume perp thì để trống, không mượn
volume spot làm mẫu số.

---

## 3. Volume Profile

Cửa sổ theo khung: 15m ≈ 2 ngày, 1h ≈ 7 ngày, 4h ≈ 3 tuần, 1D ≈ 3 tháng. Dài hơn thì
POC rơi vào một kệ lịch sử và mọi TP thành vô dụng.

**Bin** theo bậc giá, nới theo bước 1/2/5 nếu range chia ra quá nhiều bin, siết lại
nếu quá ít. Hai chế độ: `close` (mặc định) và `range` (rải đều low→high).

**POC** = bin volume lớn nhất.

**Value Area** mở rộng từ POC theo **cặp bin**, phía nào dày hơn thì lấy trước. Khi
hoà — rất hay gặp vì hai bên đều là bin rỗng — thì **nới đều cả hai phía**. Nếu luôn
ưu tiên một bên, VA sẽ trườn qua vùng không có giao dịch và POC không còn nằm giữa
value nữa.

**HVN** = đỉnh cục bộ có share đủ lớn. Biên node nới ra **chỉ khi** volume còn giảm
dần và còn ≥ 50% đỉnh, nhờ vậy node dừng ở thung lũng thay vì nuốt cả range. Node
chồng lấn được gộp.

**LVN** = đáy cục bộ share nhỏ, bỏ 5% mỗi rìa profile (rìa luôn mỏng, gọi nó là LVN
là sai).

**`nextHVN` so bằng biên gần của node, không so đỉnh.** Một node đang ôm lấy giá thì
không phải "node phía trên" hay "phía dưới" — nó là node đang chứa giá.

**Composite**: session (00:00 ICT) · 24h · 3D. Dual read: dưới POC 3D nhưng trên POC
session = **pullback**, không phải sập.

---

## 4. Price Action

- **Swing** = fractal 3 trái / 3 phải, đòi cực trị **chặt**. Hệ quả phải biết: trong
  một xu hướng trơn tuột không có nhịp hồi thì **không có swing nào hoàn chỉnh** — đó
  là hành vi đúng, không phải lỗi.
- **BOS** = đóng nến thủng swing cùng hướng cấu trúc. **CHOCH** = đóng thủng ngược.
- **Equal highs/lows** trong dung sai = **túi thanh khoản**. Stop phải nằm **ngoài**
  chúng, không nằm ngay trước.
- **Accept vs grab**: close giữ ngoài range 20 nến = **accept**. Wick ra rồi đóng
  trong = **grab**, không phải break.
- Tín hiệu nến (pin / engulfing / inside) **chỉ được tin khi volume ≥ median 20**.

---

## 5. Cấu trúc HH / HL / LH / LL

Đỉnh sau so đỉnh trước, đáy sau so đáy trước:

| Đỉnh | Đáy | Trạng thái |
|---|---|---|
| HH | HL | `uptrend` — phe mua dẫn |
| LH | LL | `downtrend` — phe bán dẫn |
| HH | LL | `broadening` — biên nới hai phía, biến động tăng |
| LH | HL | `contracting` — đang nén, sắp chọn hướng |

Điểm hướng lấy 3 swing gần nhất, cái mới nặng hơn, và có tính biên độ chênh.

**Mức bẻ gãy cấu trúc**: đang tăng thì là HL gần nhất; đang giảm thì là LH gần nhất.

---

## 6. Dòng tiền

**Taker Buy/Sell** — ai đang *chủ động đánh*. Perp và spot tách riêng; gộp lại thì
perp nặng hơn (0.65 / 0.35) và được nhân thêm khi hai chợ đồng thuận.

**Thế đứng** — ai đang *đứng ở đâu*, khác với ai đang đánh. Tỷ lệ tài khoản (nghiêng
về bán lẻ) so với tỷ trọng vị thế của nhóm lớn. **Chỗ hai số này ngược nhau mới là chỗ
đáng đọc.**

**Funding — ai trả ai.** Dương = LONG trả SHORT (đám đông đứng long và đang nuôi vị
thế). Âm thì ngược lại. Luôn quy ra %/năm (`rate × 3 × 365`) để thấy giá thật của việc
gồng. Funding **phẳng thì bỏ qua hoàn toàn**, không làm lý do.

**Open Interest**: OI↑ giá↑ = long mới · OI↓ giá↓ = long cover · OI↓ giá↑ = short cover
· OI↑ giá↓ = short mới. OI/volume cao bất thường = **cảnh báo squeeze hai chiều**,
không phải tín hiệu vào lệnh.

---

## 7. Đường kỷ luật — `decideBias`

### Stage: giá đang đứng ở đâu

Xét theo thứ tự, dừng ở điều kiện đầu tiên khớp:

1. Đóng ngoài VA **và** đã accept → `breakout` / `breakdown`
2. Đã rời hẳn value (ngoài mép quá ngưỡng ATR) mà không phải vừa accept → **không còn
   mép để bám** → coi như không có kèo
3. Đứng ở **lõi VA** (25–75% bề rộng) → không có mép để bám
4. Chạm mép trên rồi đóng lại trong value → `edge-fail`
5. Giữ mép dưới → `edge-hold`

### Cổng phát lệnh theo khung

- **15m Short**: test VAH hoặc equal high **và** đóng dưới HVN đầu tiên phía trên.
- **15m Long**: giữ VAL/POC **và** nến đóng xanh **và** không phải long đuổi đỉnh.
- **1h / 4h**: bắt buộc có nến của **chính khung đó** đã đóng.
- **1D**: chỉ đổi khi **đóng nến ngày**.

### Chấm điểm hợp lưu 0–10

Cộng: mép PA · mép VP · nến đóng xác nhận có volume · OI đồng hướng · funding
**extreme** ngược đám đông · divergence đồng hướng.

Trừ: đứng giữa VA · volume teo · RR TP1 thấp · SL quá rộng · khung lớn ngược hướng.

Chỉ `≥ 7` mới ra LONG/SHORT. `4–6.9` là WAIT nghiêng. `< 4` là WAIT.

---

## 8. Đường luôn ra hướng — `decideDirection`

Bảy vế cho điểm có dấu; tổng lại thành `net ∈ [−100, +100]`; `longScore = 50 + net/2`.
Hướng = bên điểm cao hơn. **Không bao giờ WAIT.**

| Vế | Trọng số | Cách đọc |
|---|---|---|
| Cấu trúc HH/HL | 25 | 3 swing gần nhất |
| Vị trí trong VA | 20 | fade **có điều kiện**, xem dưới |
| Taker Buy/Sell | 20 | perp 0.65 + spot 0.35, ×1.15 khi đồng thuận |
| Price Action | 18 | hướng nến đóng + accept/grab + pin/engulf, **nhân** hệ số volume |
| Open Interest | 12 | bốn cách đọc ở mục 6 |
| Funding | 8 | mức thường: theo đám đông · **extreme: đảo dấu** |
| Volume | — | **không có điểm riêng**, chỉ là hệ số nhân cho PA |

### Vì sao Volume không có điểm riêng

Nếu Volume cũng cộng/trừ theo hướng cây nến cuối thì **cùng một cây nến bị chấm hai
lần** (một lần ở PA, một lần ở Volume), và một cây 15m đơn lẻ nặng ngang cả OI. Nó chỉ
nhân vào độ tin của PA: volume lớn → ×1.4, volume teo → ×0.5.

### Vì sao vế Value Area là fade *có điều kiện*

Bản đầu mã hoá "chạm VAH thì fade xuống" vô điều kiện. Backtest đo được vế đó có
**edge âm** — nó chỉ ngược. Lý thuyết market profile vốn đã nói khác: giá được **chấp
nhận** ngoài value nghĩa là value đang dịch chuyển, phải đi theo; chỉ khi bị **từ
chối** mới là fade.

| Tình huống | Điểm | Đọc |
|---|---|---|
| Hai nến liền đóng trên VAH | `+20` | value dịch lên, đi theo |
| Hai nến liền đóng dưới VAL | `−20` | value dịch xuống, đi theo |
| Lần đầu đóng ra ngoài | `∓10` | chưa được chấp nhận, nghiêng về hồi lại |
| Trong value | `±10 × vị trí` | nghiêng nhẹ về mép gần |

Chấp nhận đo bằng **chính VA**, không mượn `accept`/`grab` của PA — vế PA đã chấm cái
đó rồi.

Vế này **chặn biên ±1**. Không chặn thì giá nằm ngoài VA cho tỷ lệ vị trí bằng 5 và
vế này ra −180 điểm, một mình nuốt hết các vế còn lại.

### Hạng tin cậy

| Hạng | Điều kiện |
|---|---|
| **★ vàng** | không vế nào ngược hướng **và** `|net| ≥ 40` **và** ≥ 3 vế có điểm |
| **A** | `|net| ≥ 30` |
| **B** | `15 ≤ |net| < 30` |
| **C** | `|net| < 15` — chỉ là thiên hướng, không phải lệnh để vào tiền |

Điều kiện hạng vàng **hiệu chuẩn bằng backtest**, không đặt bằng cảm tính. Bản đầu còn
đòi RR cao và không cảnh báo nào; bộ đó bắn **đúng 0 lần** trên 1831 tín hiệu thật, và
đo lại thì cả hai điều kiện ấy **chọn ngược** (xem mục 10).

### Cửa chất lượng — `tradeable`

Hạng tin cậy trả lời "bằng chứng lệch bao nhiêu". Cửa chất lượng trả lời câu khác:
**"kèo này có đáng đặt tiền không"**. Bốn điều kiện, tất cả do backtest hiệu chuẩn:

| Điều kiện | Vì sao |
|---|---|
| **Nhất trí** — không vế nào (trên mức nhiễu) ngược hướng | nhóm nhất trí avgR **0.17**, nhóm bị chống 0.01 |
| **Hạng ≥ B** (`\|net\| ≥ 15`) | hạng C avgR âm, và gánh gần hết phần sụt giảm |
| **R kỳ vọng ≤ 1.5** | nhóm > 1.5 avgR âm, nhóm 0.5–1 là +0.09 |
| **Phí ≤ 10% của 1R** (stop ≳ 1.2% giá) | xem ngay dưới — điều kiện mạnh nhất, và phản trực giác nhất |

Kèo trượt cửa **vẫn ra hướng** — luật cứng "không có WAIT" không đổi. Nó chỉ bị hạ
xuống *thiên hướng để theo dõi*, ghi rõ trượt vì điều kiện nào, và `size` bị ép về
`Small`. Bản điện mặc định lọc theo cửa này, bỏ tick là xem được hết.

### Điều kiện phí — vì sao stop hẹp là chỗ mất tiền

Tách R **gộp** và R **ròng** theo độ rộng stop, trên 5.661 lệnh:

| Stop (% giá) | n | R gộp | phí | R ròng |
|---|---|---|---|---|
| 0–0.5% | 397 | 0.01 | **0.394** | **−0.39** |
| 0.5–1% | 2289 | 0.17 | 0.141 | 0.03 |
| 1–1.5% | 1676 | 0.17 | 0.092 | 0.08 |
| 1.5–2% | 636 | 0.18 | 0.065 | 0.12 |
| 2–3% | 495 | 0.33 | 0.046 | 0.28 |

**R gộp gần như bằng nhau ở mọi độ rộng stop.** Chất lượng kèo không đổi. Toàn bộ
chênh lệch ròng là phí — vì phí quy ra R tỉ lệ **nghịch** với độ rộng stop. Một kèo
stop 0.5% phải thắng thêm 0.39R chỉ để hoà phí, trong khi cả cái edge đo được chỉ có
0.17R. Đây là sự thật cơ học, không phải chế độ thị trường: nó còn đúng chừng nào
còn trả phí taker.

Ngưỡng 10% ứng với stop ≈ 1.2% giá. Ngưỡng 8% (stop 1.5%) đo ra ngoài mẫu tốt hơn
(0.15 vs 0.11 ở mức lọc thấp hơn), nhưng ngồi lên đúng đỉnh một đường cong đo trên
n=599 là uốn tham số — nên lấy mức có lý do cơ học thay vì mức đẹp nhất.

**Hệ quả: cảnh báo "SL rộng quá 3% giá" đã bị đảo.** Nhóm 2–3% là nhóm **tốt nhất**
(0.28) còn nhóm 0–1% mới âm. Cảnh báo vẫn còn nhưng chỉ nhắc về đòn bẩy, không còn
hàm ý stop rộng là kèo xấu.

### Cửa đầy đủ đo được gì

| | n | % | avgR | PF | DD | ngoài mẫu avgR / PF |
|---|---|---|---|---|---|---|
| không lọc | 5661 | 100% | 0.05 | 1.11 | 116.9R | −0.00 / 0.99 |
| ba điều kiện cũ | 1177 | 21% | 0.19 | 1.66 | 11.0R | 0.11 / 1.38 |
| **bốn điều kiện** | **394** | **7%** | **0.31** | **2.16** | **6.3R** | **0.39 / 2.86** |

Ngoài mẫu **cao hơn** trong mẫu (0.39 vs 0.31) — không có dấu hiệu uốn tham số. Dương
trên cả ba khung (15m 0.41 · 1h 0.44 · 4h 0.27), cả sáu mã (0.11–0.41), cả hai chiều
(LONG 0.30 / SHORT 0.32).

**Cái giá phải trả, nói thẳng:** chỉ còn 7% số tín hiệu. 394 lệnh trên 6 mã × 3 khung
trong ~4 tháng, tức khoảng một kèo mỗi mã-khung mỗi mười ngày. Và 295 trong 394 lệnh
đó là 4h, nên mẫu của 15m (n=29) và 1h (n=70) còn mỏng.

**Size đi theo cửa, không theo số cảnh báo.** Bản trước lấy "không cảnh báo nào" làm
điều kiện của size Normal. Đo lại: 0 cảnh báo avgR 0.10, 1 cảnh báo 0.04, ≥2 cảnh báo
0.05 — không đơn điệu, tức số cảnh báo gần như không phân loại được gì. Cảnh báo vẫn
in ra đủ để người đọc tự cân, chỉ là không còn quyết định size.

---

## 9. Đặt lệnh

**Entry — luôn ở mép, hai mức.** Hai biên của HVN gần nhất theo hướng lệnh; không có
node thì bám VAH/VAL; giá đã ở ngoài value thì bám chính vùng đỉnh/đáy vừa tạo. Không
bao giờ đặt entry ở một mép cách giá vài phần trăm.

**SL — mức thesis chết.** Ngoài cụm wick **tại mép entry** + buffer, và ngoài túi
equal high/low sát bên. Neo vào đỉnh/đáy range 20 nến là sai: mức đó có thể rất xa và
khi đó stop bị nới ra "cho khỏi bị quét" — đúng lỗi bị cấm.

**TP1 — nam châm gần nhất**, chọn trong {mép VA, POC, giữa VA, đỉnh HVN đủ dày}, cách
entry tối thiểu một khoảng nhiễu. **Luôn nằm trong VA.** Chốt 50%.

**TP2** — bậc kế tiếp sau TP1. Chốt 30%. Số HVN phải xuyên đo trên **đoạn TP1→TP2**,
không đo từ entry (đoạn trước TP1 là phần đã chốt lời rồi).

**Runner** — chỉ mở sau khi khung lớn **đóng** thủng sàn/vượt trần range của nó.

**R kỳ vọng** `= 0.5×RR1 + 0.3×RR2`. Đây mới là con số đáng đo, không phải RR TP1: TP1
theo thiết kế là bậc *gần nhất* nên RR TP1 < 1 là bình thường.

---

## 10. Backtest

`npm run backtest -- --symbols BTCUSDT,ETHUSDT --tf 1h --bars 3000`

### Ba nguyên tắc

1. **Không nhìn trộm tương lai.** Tín hiệu ở nến `i` chỉ thấy `0..i`; cửa sổ profile
   bằng đúng cửa sổ live. Có test sửa hẳn giá của **toàn bộ** nến sau `i` rồi khẳng
   định tín hiệu tại `i` không đổi một byte.
2. **Cùng một code quyết định.** Đi qua `prepareTF()` y như live.
3. **Nghi ngờ thì chọn phía xấu.** Nến chạm cả SL lẫn TP thì tính **SL trước**. Entry
   khớp ở **mép xấu hơn** của vùng.

### Cách tính R

Đúng kế hoạch đang in ra: 50% ở TP1, 30% ở TP2, 20% runner cũng đóng tại TP2 cho khỏi
đoán. **SL không dời về hoà vốn** sau TP1, đúng như luật. Chạm SL trước TP1 = `−1R`;
chạm TP1 rồi quay lại SL = `0.5×R1 − 0.5`.

**Có tính phí.** 0.05% mỗi chiều theo notional, cộng 0.02% trượt giá khi thoát bằng
stop. Quy ra R thì phí phụ thuộc độ rộng stop: stop càng hẹp phí càng nặng. Trên mẫu
dưới đây phí ăn **0.130R mỗi lệnh** — tức 238.8R trên tổng 328.7R lời gộp. Bỏ qua phí
là tự thổi phồng kết quả lên gần bốn lần.

### Kết quả — 6 symbol (BTC, ETH, SOL, BNB, XRP, ENA), 3000 nến mỗi khung, **sau phí**

| Khung | n | win | avgR | PF | DD |
|---|---|---|---|---|---|
| 15m | 1258 | 57.7% | **−0.05** | 0.86 | 105.9R |
| 1h | 1840 | 55.7% | 0.05 | 1.12 | 20.5R |
| 4h | 2423 | 50.1% | 0.11 | 1.25 | 28.6R |
| **tất cả** | **5521** | 54.3% | **0.05** | 1.13 | 105.9R |

Nửa mẫu ngoài (nửa sau theo thời gian, chưa dùng để chỉnh gì): avgR **0.01**, PF 1.02.
Nói thẳng: **hệ gốc sau phí gần như không có lợi thế.**

### Cửa chất lượng — thứ thật sự tạo ra lợi thế

Toàn bộ số đo của cửa nằm ở mục 8. Tóm tắt: không lọc thì ngoài mẫu avgR −0.00 / PF
0.99; qua đủ bốn điều kiện thì **0.39 / PF 2.86** trên 7% số tín hiệu.

### Tám lần backtest lật ngược thiết kế

1. **Hạng tin cậy từng chạy ngược.** Baseline: C 0.09 > B 0.07 > A 0.02 — càng "chắc"
   càng tệ.
2. **Vế Value Area từng có edge âm −0.24.** Fade vô điều kiện là sai; đã đổi thành fade
   có điều kiện (mục 8).
3. **Điều kiện hạng vàng từng chọn ngược.** Nhóm "R kỳ vọng ≥ 1.5" cho avgR âm trong
   khi nhóm 0.5–1 dương; nhóm "0 cảnh báo" thua nhóm "≥2 cảnh báo". Mục tiêu càng xa
   càng ít khi chạm tới, mà SL thì vẫn ở đó.
4. **Dời SL về hoà vốn sau TP1: nghe hợp lý, đo ra là xấu.** Nhóm `tp1-then-sl` chiếm
   15–16% số lệnh với avgR âm, nên dời stop về hoà vốn có vẻ hiển nhiên đúng. Trên
   riêng 1h nó có vẻ đúng thật (ngoài mẫu 0.01 → 0.02). Chạy đủ ba khung thì ngược
   lại: ngoài mẫu **0.01 → −0.01**, và với lọc ≥B thì **0.04 → 0.01**. Nó cắt phần
   đuôi thắng nhiều hơn phần nó cứu. **Không nhận.** Bài học: một cải tiến chỉ đo trên
   một khung thì chưa phải một cải tiến.
5. **Bỏ bớt trọng số vế Value Area: cũng đo ra là xấu.** Bảng edge nói vế VA có edge
   **−0.04**, nên hạ trọng số 20 → 10 (thậm chí → 0) trông như việc phải làm. Đo:
   avgR 0.05 → 0.04 → 0.02, ngoài mẫu 0.01 → −0.01 → −0.02, sụt giảm tối đa
   105.9R → 125.5R → **172.9R**. **Giữ nguyên trọng số.** Lý do: `evidenceEdge` đo
   *độ đồng thuận về hướng*, còn vế VA không làm nhiệm vụ chọn hướng — nó quyết định
   **vị trí vào lệnh**. Bỏ nó đi thì hệ vào giữa value nhiều hơn, và đó đúng là điều
   luật cứng số 2 cấm. **Edge âm trong bảng đó không phải lý do đủ để bỏ một vế.**
6. **"Stop rộng là kèo xấu" — sai hoàn toàn.** Cảnh báo `SL > 3% giá` có từ bản đầu.
   Đo: nhóm stop 2–3% cho avgR **0.28**, nhóm 0–1% cho **−0.03**. Chặn stop rộng làm
   mọi chỉ số tệ đi (ngoài mẫu 0.05 → 0.01 ở ngưỡng 2%). Điều kiện đúng là ngược lại:
   stop phải đủ RỘNG để phí không nuốt hết edge (mục 8).
7. **"Entry xa giá là mức giá rác" — cũng sai.** Bắt đầu từ một output hỏng thật của
   ENAUSDT 1d (entry cách giá 7.9%). Đo phân nhóm theo khoảng cách entry: 0–0.5% cho
   **−0.02** (60% số lệnh), 1–2% cho 0.16, trên 4% cho **0.42**. Entry xa là lệnh chờ
   kiên nhẫn ở một mức thật, entry sát giá là đuổi giá. Chặn entry xa làm ngoài mẫu
   tụt 0.05 → 0.02.
8. **Cắt "value dời chỗ": đúng về khái niệm, vô dụng về số.** Dựng hẳn một bộ phát
   hiện (`lib/migration.ts`, 17 test) đo chồng lấn hai value area cộng độ mỏng của
   vùng giữa. Nó phân biệt đúng cú NHẢY với cú TRÔI ĐỀU. Nhưng đo trên 5.661 lệnh:
   ngoài mẫu 0.01 → −0.00, sụt giảm tối đa 105.6R → 116.9R. Và nó **không kích hoạt**
   trên chính ca ENAUSDT đã sinh ra nó — vì ENA đi bộ lên chứ không nhảy. Giữ code,
   **mặc định tắt**, cùng chỗ với dời-SL-về-hoà-vốn.

### Ba giới hạn phải nhớ trước khi tin những con số trên

- **Mù phái sinh.** `fapi` chặn IP nhiều vùng, nên OI / funding / taker perp là `N/A`
  trong backtest chạy từ đó. **Ba vế ấy chưa từng được kiểm chứng** — bảng edge ghi
  `n=0` cho cả ba, và đó là sự thật chứ không phải chúng vô dụng. Vế **lịch sử
  funding** (mục 6) nằm trong cùng vùng mù: nó được đặt bằng lập luận, lấy trọng số
  từ ngân sách của chính vế funding chứ không cộng thêm, và mọi dòng nó in ra đều
  kèm chữ "chưa qua backtest".
- **Một chế độ thị trường.** 4h phủ ~500 ngày, 1h ~4 tháng, 15m ~1 tháng. Không suy ra
  được chu kỳ khác.
- **Cửa đầy đủ rất kén.** 7% số tín hiệu, và 295/394 lệnh là 4h — mẫu 15m (n=29) và
  1h (n=70) còn mỏng.
- **0.130R phí mỗi lệnh là giả định.** Đúng với taker Binance perp và stop rộng cỡ
  mẫu này. Vào bằng maker, hoặc stop rộng hơn, thì con số khác.

---

## 11. Bảng hằng số

Chỗ **duy nhất** liệt kê con số. Sửa ở mã nguồn thì sửa cả đây.

### Volume Profile
| | |
|---|---|
| Cửa sổ 15m / 1h / 4h / 1D | 192 / 168 / 126 / 90 nến |
| Bin tối đa / tối thiểu | 1200 / 24 |
| HVN | share ≥ 1.2% |
| LVN | share ≤ 0.8%, bỏ 5% mỗi rìa |
| Biên node nới tới | ≥ 50% đỉnh |
| Node "đủ dày" để làm bậc TP | share ≥ 2% |
| Value Area | 70% và 80% |
| Lõi VA (cấm vào) | 25–75% bề rộng |

### Price Action & cấu trúc
| | |
|---|---|
| Fractal swing | 3 trái / 3 phải |
| Equal high/low | lệch ≤ 0.15% |
| "Chạm mép" | trong 0.4% |
| Rời hẳn value | > 1.2 ATR ngoài mép |
| Cửa sổ đọc cấu trúc | 60 nến, 3 swing gần nhất |

### Phái sinh
| | |
|---|---|
| Funding phẳng | \|FR\| < 0.02%/8h |
| Funding extreme | \|FR\| ≥ 0.05%/8h |
| Taker cân bằng | buy% trong 50 ± 3 |
| Cảnh báo squeeze | OI/volume perp > 1.5 |

### Quyết định
| | |
|---|---|
| Trọng số: cấu trúc / VA / taker / PA / OI / funding | 25 / 20 / 20 / 18 / 12 / 8 |
| Hệ số volume cho PA | ×1.4 · ×1 · ×0.5 |
| Kỷ luật: ra lệnh | score ≥ 7 / 10 |
| Hạng A / B / C | \|net\| ≥ 30 / ≥ 15 / < 15 |
| Hạng vàng | \|net\| ≥ 40 + nhất trí + ≥ 3 vế có điểm |
| **Cửa chất lượng** (`tradeable`) | **nhất trí + hạng ≥ B + R kỳ vọng ≤ 1.5 + phí ≤ 10% của 1R** |
| Ngưỡng "TP2 quá xa" (`GATE.maxRRBlended`) | 1.5 |
| Ngưỡng "mục tiêu quá sát" (`GATE.minRRBlended`) | 0.5 — **không phải 1**, nhóm 0.5–1 là nhóm tốt nhất |
| Phí tối đa theo R (`GATE.maxFeeShare`) | 0.10 → stop ≳ 1.2% giá |
| Phí giả định (`FEES`) | 0.05% mỗi chiều + 0.02% trượt giá |
| Lịch sử funding (`FUNDING_HIST`) | đảo sau ≥ 4 kỳ ×0.5 · chuỗi ≥ 8 kỳ ×0.25 — **chưa qua backtest** |
| Size Normal | qua cửa **và** hạng ≥ A (không còn phụ thuộc số cảnh báo) |
| RR TP1 bị trừ điểm | < 1.2 |
| Cảnh báo SL rộng | > 3% giá |

### Đặt lệnh & backtest
| | |
|---|---|
| Buffer cho SL | max(0.3 × ATR, 1 bin) |
| Khoảng cách tối thiểu tới TP | max(0.5 × ATR, 3 bin) |
| Tỷ lệ chốt | 50% TP1 · 30% TP2 · 20% runner |
| R kỳ vọng | 0.5×RR1 + 0.3×RR2 |
| Backtest: chờ khớp / giữ tối đa | 12 / 60 nến |
| Backtest: phí mỗi chiều / trượt giá khi dính stop | 0.05% / 0.02% notional |
| Backtest: dời SL về hoà vốn sau TP1 | **tắt** — đo ra là xấu (mục 10) |
| Cắt value dời chỗ (`valueMigration`) | **tắt** — đo ra là xấu (mục 10) |
| Ngưỡng phát hiện value dời chỗ | chồng lấn VA < 0.2 **và** vùng giữa dày < 25% mức trung bình |

---

## 12. Những gì hệ này KHÔNG làm

- Không lấy tin (unlock, listing, "sắp sập") làm trigger. Hệ **không đọc tin**.
- Không gợi ý đòn bẩy. Chỉ có size Small/Normal và rủi ro 0.5–1% tài khoản.
- Không nới SL "cho khỏi bị quét", không kéo TP xa "cho đẹp RR".
- Không bịa số. Thiếu là ghi `N/A` và **không cộng điểm, không làm lý do**.
- Không trộn spot với perp thành một con số.
- Không hardcode thiên kiến cho bất kỳ symbol nào — vàng (PAXGUSDT) chạy đúng engine
  như BTC.

**Không phải lời khuyên đầu tư.**
