# Kết quả đo — nhánh ver2

## RR nào đáng nhận (`rr-hop-ly.txt`)

386 lệnh qua cửa, 6 mã × 15m/1h/4h × 3000 nến, bộ mô phỏng đã sửa hai lỗi.
Bucket theo `rewardR` = 0.5×rr1 + 0.5×rr2 — đúng con số bảng vào tiền hiển thị
và đúng payout mà `simulate()` trả.

| RR kế hoạch | n | chạm TP1 | chạm TP2 | avgR | PF |
|---|---:|---:|---:|---:|---:|
| 0.5–0.8 | 73 | 71.2% | 67.1% | 0.09 | 1.26 |
| 0.8–1.1 | 107 | 69.2% | 59.8% | 0.19 | 1.53 |
| **1.1–1.5** | 102 | 66.7% | 58.8% | **0.34** | **1.92** |
| **1.5–2.0** | 66 | **45.5%** | **33.3%** | **−0.05** | **0.91** |

**RR cao hơn KHÔNG tốt hơn** — và có cơ chế rõ, không phải tương quan tình cờ:
ở mốc 1.5 có một **vách rơi** về tỉ lệ chạm. TP1 từ 66.7% xuống 45.5%, TP2 từ
58.8% xuống 33.3%. Phần thưởng lớn hơn không bù nổi cú sụt đó.

Lý do cơ học: TP2 đặt ở tham chiếu cấu trúc **kế tiếp**, nên RR cao nghĩa là mốc
đó ở xa — và nửa vị thế treo ở đó thường hết hạn giữ hoặc quay đầu.

Hai đầu mút KHÔNG kết luận được: RR < 0.5 nhìn rất đẹp (thắng 97%, avgR 0.27)
nhưng chỉ 31 lệnh và dồn hết vào nửa sau mẫu; RR ≥ 2.0 chỉ có 7 lệnh.

### Nếu bỏ kèo dưới ngưỡng

| ngưỡng | giữ lại | avgR | PF | ngoài mẫu avgR | ngoài mẫu PF |
|---|---:|---:|---:|---:|---:|
| không lọc | 386 (100%) | 0.18 | 1.50 | 0.31 | **2.14** |
| ≥ 0.8 | 282 (73%) | 0.20 | 1.48 | **0.36** | 2.08 |
| ≥ 1.0 | 214 (55%) | 0.22 | 1.50 | 0.32 | 1.83 |
| ≥ 1.5 | 73 (19%) | 0.02 | 1.03 | 0.20 | 1.42 |

Chênh lệch giữa "không lọc" và "≥ 0.8" nằm trong sai số. Nên **không thêm bộ lọc
RR vào cửa** — chỉ hiện nhận xét trên thẻ để người đọc thấy, không âm thầm bỏ kèo.

## Cảnh báo đòn bẩy — bản đầu là đồ trang trí

Bản đầu so `đòn bẩy cần = vị thế/vốn` với `tối đa an toàn = 50/stop%`. Làm thế
thì `stop%` **triệt tiêu** và cảnh báo chỉ bắn khi rủi ro mỗi lệnh > 50% vốn —
tức không bao giờ. Chạy lưới 16 tổ hợp vốn × rủi ro: **không lần nào bắn**.

Lỗi là so hai con số trả lời hai câu khác nhau. Đã tách thành ba mức, kiểm trên
trang thật với kèo ENAUSDT 1h (stop 1.74%):

| đòn bẩy | trạng thái |
|---|---|
| 10×, 25× | an toàn |
| 30×, 50× | ⚠ vàng — thanh lý vẫn ngoài stop nhưng đệm mỏng |
| 100× | ⚠ đỏ — thanh lý nằm **trong** stop, cháy trước |

Ở 50× thanh lý (0.15402) **vẫn xa hơn** stop (0.153633) — nói "cháy trước stop"
ở đó là sai, nên hai mức có hai câu khác nhau.

## 1000 USDT sẽ ra sao (`tai-khoan-that.txt`)

`avgR 0.18 · PF 1.50` nói về một lệnh trung bình. Người cầm tiền hỏi câu khác.
Chạy lại **386 kèo qua cửa trong 467 ngày** trên một tài khoản thật, rủi ro cố
định theo % vốn **hiện tại** — đúng cách bảng vào tiền tính khối lượng.

| rủi ro | cuối kỳ | lãi | sụt sâu nhất | đáy | chìm | thua liên tiếp |
|---|---:|---:|---:|---:|---:|---:|
| 0,5% | 1.419 | +42% | −5,7% | 984 | 125 ng | 6 |
| **1%** | **1.994** | **+99%** | **−11,3%** | 966 | **125 ng** | 6 |
| 2% | 3.831 | +283% | −21,6% | 921 | 131 ng | 6 |
| 3% | 7.096 | +610% | −31,2% | 867 | 131 ng | 6 |
| 5% | 21.819 | +2.082% | **−47,8%** | 739 | 133 ng | 6 |

Nửa sau mẫu (chưa dùng để chỉnh gì): 188 lệnh, **+81%**, sụt sâu nhất −4,3%.

**Con số đáng sợ không phải −11,3% mà là 125 ngày chìm.** Bốn tháng dưới đỉnh cũ
là lúc phần lớn người bỏ cuộc — và bỏ đúng lúc đó thì +99% kia chưa bao giờ tới
tay. Đó là thứ avgR không bao giờ nói ra.

### Trần số lệnh mở cùng lúc gần như không đổi gì

| trần | lệnh | bỏ | cuối kỳ | sụt sâu nhất |
|---|---:|---:|---:|---:|
| 1 | 283 | 103 | 1.604 | −8,7% |
| 2 | 359 | 27 | 2.021 | −9,3% |
| 3 | 379 | 7 | 1.994 | −11,3% |
| không giới hạn | 386 | 0 | 1.994 | −11,4% |

Kèo hiếm khi chồng nhau, nên trần 3 đã gần như bằng không giới hạn. Trần 1 bỏ
mất 103 lệnh mà kết quả không khá hơn.

### Một chỗ tôi đã ghi sai và đã sửa

Khối kỳ vọng trên bảng ghi *"62 ngày gần nhất của 6 mã"*. Sai — mẫu này trải
**467 ngày**. Con số 62 đến từ một lần chạy 1h-only trước đó và bị mang sang.

### Giới hạn đã nêu, nay đã gỡ: hiệu chuẩn lại ngưỡng cửa

Ngưỡng của cửa vốn được chọn từ những lần đo **còn hai lỗi mô phỏng**. Đã hiệu
chuẩn lại đi-tới: chọn trên nửa đầu, nhìn nửa sau đúng một lần để xác nhận
(`scripts/hieuchuan.ts` → `bench/hieu-chuan-cua.txt`, 5491 lệnh, 6 mã × 15m/1h/4h).

Trước khi tin bất kỳ con số nào, script dựng lại cửa từ bốn trường trên mỗi lệnh
rồi **đối chiếu với chính cờ `tradeable` máy đã ghi** — trùng cả 5491/5491.

|  | không cửa | qua cửa |
|---|---|---|
| nửa đầu | n=2745 · avgR −0,06 · PF 0,89 | n=285 · avgR 0,13 · PF 1,33 |
| nửa sau | n=2746 · avgR −0,11 · PF 0,77 | n=101 · avgR 0,33 · PF 2,34 |

**Không qua cửa thì hệ lỗ ở cả hai nửa.** Cửa là thứ duy nhất kéo nó sang dương,
và nó giữ được ở nửa sau — nửa chưa từng dùng để chọn ngưỡng.

#### Kết quả: cả bốn ngưỡng giữ nguyên, nhưng vì bốn lý do khác nhau

Đo bằng **phần chênh** — những lệnh mà đổi ngưỡng sẽ nhận thêm hoặc bỏ đi, đo
riêng chúng. So hai trung bình gộp của hai tập lồng nhau là giấu mất câu trả lời.

| vế | nửa đầu | nửa sau | đọc ra |
|---|---|---|---|
| bỏ nhất trí | +319 lệnh, avgR −0,06 | +146 lệnh, avgR −0,01 | cùng dấu hai nửa → **giữ** |
| \|net\| 15→20/25 | −30 lệnh 0,00 · −59 lệnh −0,02 | −17 lệnh **+0,36** · −24 lệnh +0,16 | đổi dấu → nhiễu, **giữ 15** |
| phí 0,10→0,15 | +206 lệnh **+0,18** (±0,069) | +223 lệnh **−0,05** (±0,053) | trong mẫu đòi nới, ngoài mẫu bác → **giữ 0,10** |
| Rkv 1,5→∞ | +39 lệnh **+0,22** | +3 lệnh −1,07 | n=42, **chưa kết luận được** |

**Vế phí là bài học đắt nhất của cả buổi.** Trong mẫu, nới từ 0,10 lên 0,15 nhận
thêm 206 lệnh lãi trung bình +0,18R — 2,6σ, đủ để bất kỳ ai gật đầu. Ngoài mẫu,
đúng cách nới đó nhận thêm 223 lệnh **lỗ** −0,05R. Chỉ nhìn nửa đầu thì đã mang
một cái đỉnh ảo vào hệ thật. Ngưỡng sống sót đúng là ngưỡng chọn bằng lý do cơ
học (phí 10% của 1R ↔ stop ≈ 1,2% giá), không phải bằng đỉnh đường cong.

#### Hai lời trong mã đã sai và đã sửa

1. `GATE.maxRRBlended` ghi *"trên mức này backtest đo ra avgR âm"*. **Dựng lại
   không ra.** Trong nhóm đã qua ba vế kia, lệnh có Rkv > 1,5 tự chúng cho avgR
   **+0,22** ở nửa đầu — vế này đang cắt lệnh lời. Nửa sau chỉ cắt 3 lệnh. Tổng
   42 lệnh: không đủ để đổi ngưỡng theo hướng nào, nhưng thừa đủ để nói rằng lời
   giải thích cũ là sai. Giữ 1,5 vì nới ra là **thêm lệnh mà không có bằng
   chứng**; sửa chú thích thành "chưa chứng minh được", và sửa luôn câu cảnh báo
   hiện ra cho người dùng vì nó đang khẳng định một điều đo không ra.
2. Bảng độ rộng stop trong `GATE.maxFeeShare` kết luận *"R gộp gần như bằng nhau
   ở mọi độ rộng — toàn bộ chênh lệch là phí"*. **Sai.** Đo lại:

   | stop | R gộp | phí | ròng | n |
   |---|---:|---:|---:|---:|
   | 0–0,5% | −0,34 | 0,29 | −0,63 | 78 |
   | 0,5–1% | 0,05 | 0,14 | −0,09 | 726 |
   | 1–1,5% | 0,02 | 0,09 | −0,07 | 963 |
   | 1,5–2% | −0,02 | 0,07 | −0,09 | 463 |
   | 2–3% | 0,17 | 0,05 | **0,13** | 388 |
   | > 3% | 0,05 | 0,03 | 0,02 | 127 |

   Cột phí khớp bảng cũ — nó là số học. Nhưng R gộp **không** phẳng: −0,34 ở
   nhóm hẹp nhất so với 0,17 ở nhóm 2–3%. Stop hẹp vừa là kèo tệ hơn vừa bị phí
   ăn nặng hơn. Phí chỉ là một nửa câu chuyện.

#### Lỗi bộ đo trong chính lần chạy này

Lần chạy đầu ra **n=0 ở mọi dòng, kể cả dòng ngưỡng bằng vô cực** — dấu hiệu
không thể là kết quả thật. Nguyên nhân: import `ROUND_TRIP` từ `lib/direct`
trong khi nhánh này không có hằng số tên đó (chỉ có `FEES`), nên vế phí thành
`NaN`, mà `NaN` so sánh kiểu gì cũng `false`. Đã sửa và **thêm kiểm chứng bắt
buộc**: dựng lại cửa phải trùng cờ `tradeable` trên từng lệnh, lệch một lệnh là
dừng. Không có bước đó thì bảng số rác vẫn trông như một kết luận.

### Giới hạn còn lại

- Nửa sau chỉ có **101 lệnh** qua cửa (3,7%). Sai số ±0,084 trên avgR 0,33.
- Vế Rkv ≤ 1,5 vẫn chưa có bằng chứng — cần mẫu dài hơn (nhiều mã, nhiều năm)
  mới đủ lệnh ở phần chênh để kết luận.
- Cửa lọc rất gắt ở giai đoạn gần đây: 10% số tín hiệu ở nửa đầu, 3,7% ở nửa sau.
