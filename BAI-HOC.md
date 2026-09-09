# Bài học từ đợt audit Market Scan

Ghi lại để lần sau không vấp lại. Mỗi bài học gắn với một sự việc có thật trong
repo này, kèm chỗ kiểm chứng được — không có bài học nào viết từ nguyên tắc chung.

---

## I. Về đo đạc

### 1. Lỗi mô phỏng nguy hiểm hơn giả định thận trọng gấp ba lần

Hai lỗi trong `simulate()` — tính khớp lệnh ở giá nến chưa in ra, và tính chốt
lời ngay trên nến vào lệnh — cộng thêm **+0.12R mỗi lệnh không có thật**. Giả
định "trong nến không biết thứ tự thì tính stop trước", sau khi thay bằng số đo
từ nến 1m, chỉ lệch **0.041R**.

Tức phần lớn cái "lợi thế" từng báo cáo là lỗi cộng vào, không phải thị trường.
Sau khi sửa, hệ không cửa từ PF 1.16 thành **PF 0.89** — từ hệ thắng nhẹ thành
hệ thua. Đó là đổi kết luận, không phải đổi con số.

**Bài học:** trước khi tin bất kỳ con số backtest nào, kiểm bộ mô phỏng trước.
Một giả định thận trọng sai thì kết quả bi quan; một lỗi mô phỏng sai thì kết
quả lạc quan — và cái lạc quan mới là cái làm mất tiền.

### 2. Mọi con số biện minh phải chết cùng lúc với thứ nó biện minh

Comment trong `direct.ts` ghi "lọc bằng ba điều kiện nâng avgR 0.05 → 0.18, PF
1.13 → 1.61". Những con số đó đo bằng bộ mô phỏng còn lỗi. Chúng nằm im trong
code như bằng chứng suốt nhiều tháng.

**Bài học:** khi bộ đo thay đổi, phải đi tìm và thay MỌI con số đã đo bằng bộ cũ
— trong code, trong tài liệu, trong comment. Để nguyên số cũ ở tài liệu còn tệ
hơn ở comment, vì tài liệu là thứ người ta tin.

### 3. Không có đối chứng ngược thì không kết luận được gì

Bốn biến thể trọng số cho ra bốn con số khác nhau. Cái nào cũng "giải thích
được". Chỉ khi thêm **đối chứng ngược** — giữ đúng những vế đo ra nhiễu, bỏ hai
vế có bằng chứng — mới biết được là cấu trúc + taker thật sự mang tín hiệu: đối
chứng tệ hơn hẳn mọi bản khác trên n=2795.

**Bài học:** mỗi giả thuyết "A quan trọng" phải kèm một lần chạy bỏ A đi. Không
có nó, cải thiện và may mắn nhìn giống hệt nhau.

### 4. Đưa sai số chuẩn ra cùng con số, luôn luôn

`avgR 0.30` và `avgR 0.03` trông như một trời một vực. Với n=25 thì sai số là
**±0.21** — chênh lệch đó không phân biệt được với ngẫu nhiên.

Dấu hiệu chắc chắn nhất rằng một cột là nhiễu: **thứ hạng lật ngược giữa hai nửa
mẫu**. v2 dẫn ở nửa đầu (0.25 vs 0.07) rồi thua hẳn ở nửa sau (0.03 vs 0.30).

**Bài học:** một con số không kèm n và sai số thì chưa phải kết quả. Và luôn chia
đôi mẫu theo thời gian — cái đẹp lên trong mẫu mà đảo chiều ngoài mẫu là uốn tham
số, không phải phát hiện.

### 5. Ngưỡng nên chọn vì lý do cơ học, không vì đường cong

Sweep ngưỡng kỳ vọng: mức **0** kéo PF 0.84 → 0.97. Mức **≥0.3** cho PF 1.82 ở
nửa đầu — và **0.73** ở nửa sau (n=25). Đỉnh đẹp nhất của đường cong chính là chỗ
uốn tham số.

Chọn 0 vì nó là mức duy nhất có nghĩa cơ học: dưới 0 là kèo mà chính bảng xác
suất của mình nói là lỗ.

**Bài học:** khi phải chọn một ngưỡng, ưu tiên mức có lý do vật lý (phí, hoà vốn,
biên) hơn mức đo ra đẹp nhất.

---

## II. Về mô hình

### 6. Nhãn sai nguy hiểm hơn số sai

Màn hình ghi "R kỳ vọng = 0.5×RR1 + 0.3×RR2". Con số đó không phải kỳ vọng — nó
giả định xác suất thắng 100%. Nó cũng không khớp với chính bộ mô phỏng (trả
0.5/0.5), nên hai trọng số cộng lại 0.8 và phần runner 20% bị bỏ rơi lặng lẽ.

Hệ quả xa hơn: ngưỡng cửa `maxRRBlended = 1.5` được hiệu chuẩn trên **một thang
khác** thang mà backtest thật sự chi trả.

**Bài học:** một đại lượng bị gọi sai tên sẽ kéo theo mọi ngưỡng đặt trên nó. Đặt
tên đúng trước, hiệu chuẩn sau.

### 7. Xác suất phải đo theo thứ QUYẾT ĐỊNH nó

Tỉ lệ chạm TP đo theo **độ xa tính bằng R** giữ nguyên hình dạng ở cả hai nửa
mẫu. Đo theo **hạng tin cậy** thì nửa sau lệch hẳn nửa đầu (hạng C: 46.8% →
56.2%).

Và chia theo hạng còn mở một lỗ hổng: kéo TP2 ra thật xa mà xác suất không đổi
thì kỳ vọng tăng vô hạn — đúng cái bệnh mà ngưỡng cứng `maxRRBlended` phải chặn
bằng tay.

**Bài học:** chọn biến điều kiện theo cơ chế, không theo cái sẵn có.

### 8. Một mô hình có thể đúng ở một vùng và sai ở vùng khác

Đối chiếu kỳ vọng dự báo với R thực hiện: quanh 0 bám khá sát, nhưng ô [0.15,
0.30) dự báo **+0.200** mà thực tế **−0.210** — ô dự báo cao nhất lại là ô tệ
nhất.

Nên con số đó dùng làm **nhãn** và làm **ngưỡng âm/dương** thì hợp lệ; dùng để
**xếp hạng** kèo thì sai.

**Bài học:** kiểm hiệu chuẩn theo từng vùng giá trị, đừng chỉ nhìn sai số trung
bình. Và nói rõ mô hình dùng được vào việc gì, không dùng được vào việc gì.

### 9. Bỏ sạch một vế "nhiễu" là quả quyết hơn mức bằng chứng cho phép

OI (+0.05) và PA (+0.04) đều dưới ngưỡng nhiễu nhưng **đều dương** và đo trên mẫu
lớn. v2 giảm trọng số của chúng chứ không bỏ. Chỉ funding bị bỏ hẳn — vế duy nhất
có edge **âm** (−0.12).

**Bài học:** "không chứng minh được là có tác dụng" khác "chứng minh được là vô
dụng". Phản ứng đúng với vế thứ nhất là giảm trọng số, không phải xoá.

### 10. Bỏ một vế khỏi bảng điểm khác với bỏ nó khỏi hệ

`valueLocation = 0` chỉ bỏ **vế chấm điểm** của Value Area. Volume profile vẫn
dựng toàn bộ entry/SL/TP — mọi mức giá vẫn ra từ POC, VA, HVN, LVN.

**Bài học:** trước khi cắt, phân biệt "thứ này chấm điểm" với "thứ này dựng mức
giá". Cắt nhầm loại thứ hai là phá hệ chứ không phải thu gọn hệ.

---

## III. Về kỹ thuật

### 11. Sửa bằng script thì phải kiểm file đã đổi thật chưa

Commit `f3486f9` mô tả một bản sửa mà **diff của nó không hề chứa**. Lệnh shell
bị giết giữa chừng (exit 144), python không ghi được file nào, `git commit` sau
đó vẫn chạy và vẫn ghi lại thông điệp. Lịch sử nói đã sửa, code thì chưa — và
lần đo tiếp theo chạy bằng code còn lỗi.

**Bài học:** mỗi bước thay thế phải có `assert`, và sau khi chạy phải `grep` xác
nhận file đã đổi, TRƯỚC khi commit. Một commit mô tả việc không có thật còn nguy
hiểm hơn không commit.

### 12. Cờ boolean phải hỏi `includes`, không hỏi `arg()`

`arg('deriv')` trả về giá trị **đứng sau** cờ. `--deriv` ở cuối dòng lệnh luôn
cho `undefined` → cờ im lặng thành `false`. Hai file kết quả ra **giống hệt
nhau** vì cả hai đều chạy mù phái sinh.

Dấu hiệu phát hiện: hai lần chạy khác cấu hình mà ra số y hệt.

### 13. Cùng một cái tên phải là cùng một thứ

Đường live gọi taker perp với `period=15m&limit=48` rồi lấy 8 dòng cuối = **2
giờ**, không đổi theo khung. Backtest ban đầu lấy 8 nến của khung backtest — trên
4h là **32 giờ**, rồi gọi kết quả bằng đúng cái tên "taker perp".

**Bài học:** khi tái tạo một chỉ số cho backtest, đối chiếu từng tham số với
đường live: chu kỳ, số mẫu, cửa sổ. Hai thứ khác nhau đội cùng một tên là cách
chắc chắn nhất để kết luận sai.

### 14. Thiếu dữ liệu phải thành N/A, không thành số mặc định

Bốn chỗ đã áp: profile "3 ngày" khi chỉ có 2 ngày → trả `null` và nói ra; funding
chưa có kỳ nào → `UNAVAILABLE`, không phải 0; feed nến 1m phủ một phần → trả
`null` chứ không trả rỗng; ô xác suất chưa đủ mẫu → ngoại suy THẤP hơn quan sát
và đánh dấu.

**Bài học:** giá trị mặc định cho một vế thiếu là cách chắc chắn nhất để backtest
báo có edge ở một chỗ không có gì.

### 15. Đọc kho dữ liệu: mỗi nguồn một quy ước

Đã vấp đủ bốn cái:

| Bẫy | Hậu quả nếu bỏ qua |
|---|---|
| Kline **spot** dùng micro giây, **futures** dùng mili giây | Mọi nến rơi ngoài cửa sổ, hàm lặng lẽ trả rỗng |
| `create_time` của metrics là chuỗi UTC, không phải epoch | Lệch cả múi giờ, không báo lỗi |
| Funding không phải lúc nào cũng 8h/kỳ (ENA: 4h) | Cộng thẳng là nhân đôi con số |
| Tháng hiện tại chưa có file tháng | Mất đúng đoạn dữ liệu gần đây nhất |

Cái cuối đáng chú ý: nó luôn cắt mất **đoạn mới nhất**, tức đoạn đáng tin nhất.
Lần đầu chỉ phủ 68% số lệnh, lần sau chỉ còn 2380/3000 nến.

### 16. Trạng thái trong bộ nhớ không bắc cầu được giữa các tiến trình

Log server ghi "quét nền: bật · 4 mã" trong khi API trả `running: false`. Sửa lần
một bằng `globalThis` — **vẫn sai**. Lý do thật: Next chạy `instrumentation.ts`
và route handler ở **tiến trình khác nhau**.

Lời giải đúng lại hoá ra tốt hơn về mặt ý nghĩa: đọc từ CSDL. Nó trả lời "có lượt
quét nào thật sự xảy ra gần đây không" thay vì "có biến nào đang bật không". Một
bộ hẹn giờ còn sống mà mọi lượt đều ném lỗi thì `running: true` là câu trả lời
sai.

**Bài học:** khi trạng thái phải dùng chung, hỏi thứ ghi lại được, đừng hỏi biến.

---

## IV. Cái đắt nhất

### 17. Giả thuyết hay nhất vẫn phải đo trước khi sửa

Nhìn màn hình thấy kèo `rr1 ≈ 0.1` — TP1 gần hơn cả phí. Nghi bộ dựng mức giá
đang rò kèo hỏng. Đo trên 16515 tín hiệu: **368 kèo (2.2%) rơi vào đó, và cửa
chặn đúng 100%**. Không có rò rỉ, không có gì để sửa.

Nếu sửa trước khi đo, tôi đã viết một bản vá cho một lỗi không tồn tại, và có lẽ
đã báo cáo nó như một cải tiến.

Thứ duy nhất đáng sửa hoá ra là **cách nói**: "kỳ vọng −0.54R" đúng nhưng không
cho biết kế hoạch **tự nó** đã hỏng.

### 18. Kết quả âm cũng là kết quả, và thường rẻ hơn

Ba câu hỏi lớn, cả ba trả lời "không":

- Ba vế phái sinh (40/103 trọng số) có làm được việc gì không? → **Không.** PF
  0.89 → 0.89, ngoài mẫu y hệt.
- Chạy trên nến perp có tốt hơn nến spot không? → **Không.** PF 0.87 vs 0.89.
- Bỏ funding có làm phần qua cửa tốt lên không? → **Không.** Cái đẹp lên trong
  mẫu đảo chiều ngoài mẫu.

Mỗi câu "không" gỡ đi một lo lắng và đóng một hướng. Đó là tiến bộ thật, chỉ là
không nhìn giống tiến bộ.

---

## Trạng thái hiện tại, nói thẳng

- Hệ **chưa có lợi thế đã chứng minh**. v1 PF 0.80, v2 PF 0.88–0.90 trên tập lệnh
  rộng ngoài mẫu — v2 lỗ **ít hơn**, không phải có lãi.
- Kết luận **chắc chắn nhất**: kèo không qua cửa là kèo lỗ (t = −3.64), và bỏ cấu
  trúc + taker làm hệ tệ đi rõ rệt. Bộ lọc có tác dụng, và hai vế đó mang tín hiệu.
- Nút thắt **không phải trọng số** mà là mẫu: sau 3000 nến × 6 mã × 3 khung, phần
  ngoài mẫu qua cửa chỉ còn **25–28 lệnh**, sai số ±0.21. Cửa lọc quá chặt để tự
  kiểm chứng chính nó.

Việc đáng làm tiếp không phải chỉnh thêm trọng số. Là **kéo dài lịch sử** (nhiều
mã hơn, nhiều năm hơn) cho tới khi phần ngoài mẫu qua cửa đủ vài trăm lệnh. Trước
mốc đó, mọi so sánh giữa các bản đều nằm trong sai số.
