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

### Giới hạn phải nêu

Ngưỡng của cửa vốn được chọn từ những lần đo **còn hai lỗi mô phỏng**. Bộ đo nay
đã đúng, nhưng việc chọn ngưỡng thì chưa độc lập với chính dữ liệu này.
