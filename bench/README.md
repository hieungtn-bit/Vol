# Đo lại từ đầu sau khi sửa sáu lỗi

Mọi con số avgR/PF ghi ở bất kỳ đâu **trước commit `bf0be29`** đều phải bỏ: chúng
đo bằng một bộ mô phỏng có hai lỗi.

## Cách chạy lại

    npx tsx scripts/backtest.ts --symbols BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT \
      --tf 15m,1h,4h --bars 3000 --intrabar 1m --save "nhãn"

`--save` ghi vào SQLite kèm cấu hình, phạm vi thời gian, dấu kiểm tra dữ liệu
(sha256 của chính chuỗi nến) và git rev — đủ để đối chiếu hai lần chạy và trả lời
được "khác vì dữ liệu hay khác vì code".

| file | nội dung |
|---|---|
| `1h-3000-truoc-sua.txt` | 148574f — còn cả hai lỗi mô phỏng |
| `1h-3000-sau-sua.txt` | bf0be29 — đã sửa, vẫn dùng giả định thận trọng |
| `full-sau-sua.txt` | 6 mã × 15m/1h/4h, giả định thận trọng |
| `full-nen1m.txt` | 6 mã × 15m/1h/4h, **gỡ thứ tự bằng nến 1m** |
| `intrabar-full.txt` | so trực tiếp giả định vs nến 1m |
| `hitrates.txt` | tỉ lệ chạm TP1/TP2 theo độ xa — nguồn của bảng xác suất |
| `expectancy-sweep.txt` | hiệu chuẩn ngưỡng `GATE.minExpectancy` |

## Ba nguồn sai lệch, tách riêng từng cái

Cùng dữ liệu, chỉ đổi một thứ mỗi lần (6 mã × 15m/1h/4h, ~5300 lệnh):

| | avgR | PF | ngoài mẫu PF |
|---|---:|---:|---:|
| **(a)** còn hai lỗi mô phỏng | +0.07¹ | 1.16¹ | 1.02¹ |
| **(b)** sửa lỗi, giả định thận trọng | −0.08 | 0.85 | 0.78 |
| **(c)** sửa lỗi, gỡ thứ tự bằng nến 1m | −0.04 | 0.92 | 0.83 |

¹ đo trên lát 4 mã × 1h; lát rộng chưa từng được đo với bản còn lỗi.

- (a)→(b): **hai lỗi cộng thêm ~+0.12R mỗi lệnh KHÔNG có thật.** Đó là phần lớn
  cái "edge" từng báo cáo.
- (b)→(c): **giả định thận trọng tính THIẾU 0.041R mỗi lệnh** — có thật, và giờ
  đã đo được thay vì đoán. 150/4946 lệnh đổi kết quả, cả 150 đều tốt lên (đúng
  một chiều, như dự đoán từ hình dạng của giả định).

Nói cách khác: sai lệch do lỗi lớn gấp ba lần sai lệch do giả định.

## Kết luận trên thang đo đúng (nến 1m)

| biến thể | n | avgR | PF | ngoài mẫu PF |
|---|---:|---:|---:|---:|
| không cửa nào | 5329 | −0.04 | 0.92 | 0.83 |
| cửa cũ | 4352 | −0.02 | 0.96 | 0.88 |
| **cửa đầy đủ** | 1983 | **+0.02** | **1.05** | **1.04** |
| cửa đầy đủ + SL ≥ 1.5% | 1252 | +0.02 | 1.03 | 1.08 |

Kiểm định trên chính cờ `tradeable` mà giao diện đang hiện là "qua cửa"
(n=5511 lệnh đã lưu trong SQLite, backtest #2):

    mọi lệnh          n=5511  avgR=-0.052  t=-3.64  KTC95% [-0.081, -0.024]
    chỉ lệnh qua cửa  n=156   avgR=+0.194  t=+2.36  KTC95% [+0.033, +0.355]

Đọc đúng như sau, không hơn:

1. **Kèo KHÔNG qua cửa là kèo lỗ, và điều đó chắc chắn** (t = −3.64). Đây là kết
   luận mạnh nhất rút ra được, và nó là lý do giữ bộ lọc.
2. **Kèo qua cửa dương, nhưng chỉ vừa đủ để phân biệt với 0** (t = 2.36, cận dưới
   khoảng tin cậy là +0.03R). Với n=156 và với việc đây là bộ lọc còn lại sau khi
   đã thử vài bộ, con số này là **một giả thuyết có bằng chứng ủng hộ, chưa phải
   một lợi thế đã chứng minh.**
3. Đừng đọc "PF 1.05" thành "hệ có lãi". 1983 lệnh cho +0.02R mỗi lệnh, trong khi
   độ lệch chuẩn mỗi lệnh là 1.07R — tín hiệu nhỏ hơn nhiễu rất nhiều.

## Kỳ vọng có xác suất: dùng làm nhãn, không dùng để xếp hạng

Đối chiếu kỳ vọng dự báo với R thực hiện (5460 lệnh):

| dự báo | n | dự báo | thực tế |
|---|---:|---:|---:|
| [−0.05, 0.05) | 1130 | −0.006 | −0.020 |
| [0.05, 0.15) | 411 | +0.092 | −0.012 |
| [0.15, 0.30) | 170 | +0.200 | **−0.210** |

Quanh 0 mô hình bám sát → dùng làm ngưỡng âm/dương là hợp lệ (PF 0.84 → 0.97).
Phía cao lạc quan có hệ thống → **không** dùng để xếp hạng kèo. Ngưỡng để đúng 0,
là mức duy nhất có lý do cơ học; mọi ngưỡng cao hơn đều tệ đi khi đo ngoài mẫu.

## Giới hạn còn lại

- Backtest chạy **mù phái sinh**: OI / funding / taker perp = N/A. Ba vế đó chưa
  bao giờ được kiểm chứng, nên trọng số của chúng vẫn là niềm tin.
- Nến dùng là **spot**, trong khi hệ khuyến nghị trên perp.
- Nến 1m gỡ được tới mức phút; trong chính phút đó vẫn giữ giả định phía xấu.
