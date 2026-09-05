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

### Kết quả — 4 symbol (BTC, ETH, ENA, SOL), ~3000 nến mỗi khung

| Khung | n | win | avgR | PF | DD |
|---|---|---|---|---|---|
| 15m | 853 | 60.0% | 0.13 | 1.43 | 8.8R |
| 1h | 1239 | 56.6% | 0.19 | 1.57 | 10.8R |
| 4h | 1596 | 51.6% | 0.20 | 1.50 | 11.5R |

avgR theo hạng:

| Hạng | 15m | 1h | 4h |
|---|---|---|---|
| ★ vàng | **0.28** | **0.35** | **0.42** |
| A | 0.09 | 0.30 | 0.28 |
| B | 0.22 | 0.22 | 0.25 |
| C | 0.07 | 0.12 | 0.10 |

★ vàng nhất và C bét ở **cả ba** khung. Hiệu chuẩn chỉ làm trên 1h; 4h và 15m là khung
chưa dùng để chỉnh gì mà thứ bậc vẫn giữ. Ở 15m thì A tụt dưới B — mẫu A nhỏ nên chưa
kết luận được, nhưng ghi lại chứ không lờ đi.

### Ba lần backtest lật ngược thiết kế

1. **Hạng tin cậy từng chạy ngược.** Baseline: C 0.09 > B 0.07 > A 0.02 — càng "chắc"
   càng tệ.
2. **Vế Value Area từng có edge âm −0.24.** Fade vô điều kiện là sai; đã đổi thành fade
   có điều kiện (mục 8).
3. **Điều kiện hạng vàng từng chọn ngược.** Nhóm "R kỳ vọng ≥ 1.5" cho avgR **−0.03**
   trong khi nhóm 0.5–1 cho +0.24; nhóm "0 cảnh báo" thua nhóm "≥2 cảnh báo"
   (0.14 vs 0.21). Mục tiêu càng xa càng ít khi chạm tới, mà SL thì vẫn ở đó.

### Ba giới hạn phải nhớ trước khi tin những con số trên

- **Mù phái sinh.** `fapi` chặn IP nhiều vùng, nên OI / funding / taker perp là `N/A`
  trong backtest chạy từ đó. **Ba vế ấy chưa từng được kiểm chứng.**
- **Một chế độ thị trường**, khoảng 4 tháng. Không suy ra được chu kỳ khác.
- **Chưa tính phí và trượt giá.** Thêm vào thì mọi avgR tụt xuống.

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
