# logic.md — luật của engine, một trang

Mọi symbol chạy **cùng một engine**. Không có ngoại lệ hardcode cho bất kỳ mã nào.

## 0. Nguyên tắc cứng

| Luật | Thi hành ở đâu |
|---|---|
| WAIT là kết luận hợp lệ, không ép Long/Short | `decideBias` — chỉ ra lệnh khi score ≥ 7 **và** cổng TF mở |
| Cấm vào giữa value (POC / lõi VA) | `classifyStage` trả `mid-range` khi `inMidValue`, và `-4` điểm |
| Giá đã rời hẳn value (> 1.2 ATR ngoài mép) cũng là "không có mép" | `classifyStage` |
| Tin tức không bao giờ là trigger | không có nguồn tin nào trong hệ |
| Không bịa số | thiếu dữ liệu → `quality: 'UNAVAILABLE'`, in `N/A`, **không vào danh sách lý do** |
| Không trộn spot với perp | `DeltaInfo.venue` tách `binance-spot` / perp; perp 451 → perp taker = N/A |
| Không gợi ý đòn bẩy | chỉ có `size: Small | Normal` + "rủi ro 0.5–1% tài khoản" |
| TP1 bắt buộc trong VA | danh sách bậc TP chỉ chứa mốc nằm trong VA70 |
| Cấm TP xuyên 3–4 HVN trên full size | đo số HVN trên đoạn **TP1→TP2**, kéo về bậc kế tiếp, còn dư thì cảnh báo |
| SL = mức thesis chết | neo vào cụm wick ở **mép entry** + buffer, **không** neo vào đỉnh/đáy range 20 nến |
| Mỗi TF độc lập | mỗi TF có profile + PA + cổng riêng; TF lớn chỉ vào score dưới dạng `-1.5` khi ngược hướng |
| Output có invalidation | `invalidation` luôn ở dạng "đóng nến X trên/dưới Y thì hủy" |

## 1. Price Action (`lib/priceAction.ts`)

- Swing = fractal 3 trái / 3 phải, trên cửa sổ 20–50 nến gần nhất.
- **BOS** = đóng nến thủng swing **cùng** hướng cấu trúc. **CHOCH** = đóng thủng **ngược** cấu trúc.
- **Equal highs/lows** (lệch ≤ 0.15%) = túi SL. Stop phải nằm ngoài chúng, không nằm ngay trước.
- Nến pin / engulfing / inside chỉ được tin khi `vol ≥ median 20`; vol dưới median thì tín hiệu chỉ được `+0.5`.
- **Accept vs grab**: close giữ ngoài range 20 nến = **accept**. Wick ra rồi đóng trong = **grab**, không phải break.
- `rangePos` = vị trí close trong range 20 nến, 0–100.

## 2. Volume Profile (`lib/volumeProfile.ts`)

- Hai mode: `close` (mặc định, volume dồn vào bin của giá đóng) và `range` (rải đều low→high).
- Bin theo bậc giá; nới theo bước 1/2/5 nếu range chia ra > 1200 bin (BTC), và ghi chú rõ trong `binNote`.
- **POC** = bin volume lớn nhất. **VA70/VA80** mở rộng từ POC theo cặp bin, phía nào dày hơn thì lấy trước; **hoà thì nới đều hai phía** (nếu luôn ưu tiên một bên, VA sẽ trườn qua vùng rỗng và POC không còn nằm giữa value).
- **HVN** = đỉnh cục bộ share ≥ 1.2%; biên node nới ra chỉ khi volume còn giảm dần và còn ≥ 50% đỉnh. Node chồng lấn được gộp.
- **LVN** = đáy cục bộ share ≤ 0.8%, bỏ 5% mỗi rìa profile.
- `nextHVN` so bằng **biên gần** của node: node đang ôm lấy giá không phải "node phía trên" hay "phía dưới".
- Cửa sổ profile mỗi TF: 15m ≈ 2 ngày · 1h ≈ 7 ngày · 4h ≈ 3 tuần · 1D ≈ 3 tháng. Cửa sổ dài hơn thì POC rơi vào kệ lịch sử và mọi TP thành vô dụng.
- **Composite**: session (00:00 ICT) · 24h · 3D. Dual read: dưới POC 3D + trên POC session = **pullback**, không phải sập.

## 3. OI · Funding · Delta (`lib/derivatives.ts`)

- Funding `|FR| < 0.02%/8h` = **phẳng** → bỏ qua, không làm lý do, không cộng điểm. Chỉ `|FR| ≥ 0.05%/8h` (extreme) và **ngược đám đông** mới được `+1`.
- OI: `↓ giá ↓` = long cover · `↑ giá ↑` = long mới · `↓ giá ↑` = short cover · `↑ giá ↓` = short mới.
- `OI/vol24h > 1.5` = cảnh báo squeeze hai chiều — **không** phải tín hiệu vào lệnh. Tử số và mẫu số phải **cùng một chợ** (OI perp / volume perp); không có volume perp thì bỏ trống, tuyệt đối không lấy volume spot làm mẫu số.
- Delta: taker buy từ kline **spot** là số thật nhưng thuộc chợ spot, luôn gắn nhãn. Không có taker → close-direction, gắn nhãn **PROXY**.
- Divergence: giá LL + CVD HL = regular bullish; giá HH + CVD LH = regular bearish. So hai nửa cửa sổ 40 nến, không dò từng đỉnh nhỏ.
- `delta-at-price` (delta theo bin) được ưu tiên hơn CVD thời gian.

## 4. Confluence 0–10 (`scoreConfluence`)

Cộng: mép PA `+2` · mép VP `+2` · nến đóng xác nhận có volume `+2` (không có volume `+0.5`) · OI đồng hướng `+1.5` · funding extreme ngược đám đông `+1` · divergence đồng hướng `+1`.

Trừ: đứng giữa VA `-4` · volume teo (< 60% median 20) `-1.5` · RR TP1 < 1.2 `-2` · SL > 3% giá `-1.5` · TF lớn ngược hướng `-1.5`.

`≥ 7` → LONG/SHORT · `4 – 6.9` → WAIT nghiêng · `< 4` → WAIT.

## 5. Cổng phát lệnh theo TF

- **15m Short**: test VAH hoặc equal high **và** đóng dưới HVN đầu tiên phía trên.
- **15m Long**: giữ VAL/POC **và** nến đóng xanh **và** không phải long đuổi HH (`rangePos > 80` hoặc vừa accept lên trên → cấm).
- **1h / 4h**: bắt buộc có nến của chính TF đó đã đóng; nến cuối phải đóng đúng hướng (trừ khi đang breakdown/breakout).
- **1D**: chỉ đổi khi **đóng nến ngày**. Intraday không in 1D Long/Short trừ khi đã phá cấu trúc bằng nến ngày đóng.

Vào lệnh ngược TF lớn → `counterTrend = true`, `size = Small`, plan ghi "TP1 bắt buộc chốt".

## 6. Đặt số

- **Entry** — hai mức, luôn ở mép: hai biên của HVN gần nhất theo hướng lệnh; không có node thì bám VAH/VAL; giá đã ở ngoài value thì bám chính vùng đỉnh/đáy vừa tạo (không bao giờ đặt entry ở mép nằm cách giá vài phần trăm).
- **SL** — ngoài cụm wick tại mép entry + buffer `max(0.3·ATR, 1 bin)`, và ngoài túi equal-high/low sát bên.
- **TP1** — **nam châm gần nhất** trước mặt lệnh, chọn trong {VA edge, POC, giữa VA, đỉnh HVN có share ≥ 2%}, cách entry tối thiểu `max(0.5·ATR, 3 bin)`. Luôn nằm trong VA. Chốt 50%.
- **TP2** — bậc kế tiếp sau TP1. Chốt 30%.
- **Runner** — chỉ mở sau khi TF lớn **đóng** thủng sàn/vượt trần range của nó.
- **RR** tính từ mép entry gần giá nhất.

## 7. Cảnh báo đỏ

Entry rơi vào lõi VA · RR TP1 < 1 · SL > 3% giá (isolated đòn bẩy cao = cháy) · TP1 rớt ngoài VA · đoạn TP1→TP2 còn xuyên ≥ 3 HVN · OI/vol24h bất thường.

## 8. Nguồn dữ liệu

`data-api.binance.vision` (spot klines + ticker 24h, fallback `api.binance.com`) · `fapi.binance.com` (perp — trả 451/403 từ hầu hết VPS US/EU, khi đó taker perp = **N/A**) · `www.okx.com` public v5 (funding, mark, open interest, OI history). Cache 15–30s, gộp request trùng key. Mỗi lần scan lưu một snapshot JSON để so lại.

---
**Không phải lời khuyên đầu tư.**

---

## 9. Bản điện luôn-ra-hướng (`/live`)

Bảng ở `/` giữ nguyên kỷ luật cũ: score < 7 thì WAIT. Bản điện ở `/live` trả lời một
câu hỏi khác — **"nếu buộc phải chọn thì chọn bên nào"** — nên **không bao giờ có WAIT**.

Bỏ WAIT không phải là giả vờ lúc nào cũng có kèo đẹp. Nó được bù lại bằng **hạng tin cậy**:

| Hạng | Điều kiện | Nghĩa |
|---|---|---|
| **A** | \|net\| ≥ 30 | bằng chứng lệch hẳn về một phía |
| **B** | 15 ≤ \|net\| < 30 | lệch vừa |
| **C** | \|net\| < 15 | hai phía gần cân nhau — chỉ là thiên hướng, không phải lệnh để vào tiền |

`net` ∈ [−100, +100]; `longScore = 50 + net/2`, `shortScore = 100 − longScore`.
Hướng = bên có điểm cao hơn. Size chỉ được `Normal` khi hạng A **và** không có cảnh báo nào.

### Bảy vế chấm điểm

| Vế | Trọng số | Cách đọc |
|---|---|---|
| Cấu trúc HH/HL/LH/LL | 25 | đỉnh sau vs đỉnh trước, đáy sau vs đáy trước; 3 swing gần nhất, cái mới nặng hơn |
| Vị trí trong Value Area | 20 | ở VAL → ủng hộ long, ở VAH → ủng hộ short, giữa VA → gần trung tính |
| Taker Buy/Sell | 20 | perp 0.65 + spot 0.35; ×1.15 khi hai chợ đồng thuận |
| Price Action | 18 | hướng nến đóng + accept/grab + pin/engulf, **nhân** hệ số volume |
| Open Interest | 12 | long mới +1 · short cover +0.6 · short mới −1 · long cover −0.6 |
| Funding | 8 | mức thường: theo chiều đám đông · mức extreme: **đảo dấu** (đám đông quá lệch là nhiên liệu cho cú ép ngược) |
| Volume | — | **không có điểm riêng**. Nó là hệ số nhân cho PA: ≥1.5× median → ×1.4, <0.6× → ×0.5. Nếu volume cũng cộng điểm theo hướng cây cuối thì cùng một cây nến bị tính hai lần. |

### Cấu trúc HH/HL/LH/LL

Swing = fractal 3-trái/3-phải, đòi cực trị **chặt**. Hệ quả cần biết: trong một xu hướng
trơn tuột không có nhịp hồi thì **không có swing nào hoàn chỉnh** — đó là hành vi đúng,
không phải lỗi.

- HH + HL → `uptrend` · LH + LL → `downtrend`
- HH + LL → `broadening` (biên nới hai phía) · LH + HL → `contracting` (nén, sắp chọn hướng)
- Mức bẻ gãy: đang tăng thì là HL gần nhất, đang giảm thì là LH gần nhất.

### Ai đang trả ai

Funding dương = **LONG trả SHORT** (đám đông đứng long và đang nuôi vị thế). Âm thì ngược lại.
Luôn quy thêm ra %/năm (`rate × 3 × 365`) để thấy giá thật của việc gồng.

Kèm hai số "ai đang ĐỨNG ở đâu" (khác với "ai đang ĐÁNH"):
`globalLongShortAccountRatio` đếm theo tài khoản nên nghiêng về bán lẻ, `topLongShortPositionRatio`
theo giá trị vị thế của nhóm lớn. **Chỗ hai số này ngược nhau mới là chỗ đáng đọc.**

### Buy/Sell tách chợ

Taker perp và taker spot **luôn hiển thị tách rời**, không gộp thành một con số. Chỉ khi cả
hai cùng nghiêng một phía mới ghi "đồng thuận" và mới được nhân hệ số tin cậy.
