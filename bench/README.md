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

## Một giả thuyết đã bị chính số đo bác bỏ

Nhìn màn hình thấy một kèo BTC 15m có `rr1 ≈ 0.1` — TP1 chỉ cách entry 0.043% giá,
tức **gần hơn cả vòng phí vào-ra 0.12%**. Nghi bộ dựng mức giá đang rò kèo hỏng.

Đo trên 16515 tín hiệu (`scripts/levels.ts`, 3 mã × 15m/1h/4h):

| | n | tỉ lệ | trong đó qua cửa |
|---|---:|---:|---:|
| TP1 gần hơn phí vào-ra (0.120%) | 368 | 2.2% | **0** |
| TP1 gần hơn 2× phí | 1737 | 10.5% | — |
| rr1 < 0.15 | 160 | 1.0% | **0%** |
| rr1 0.15–0.3 | 1363 | 8.3% | 0.1% |

**Cửa chất lượng đã chặn 100% số kèo đó.** Không có rò rỉ, và không có gì để sửa
trong thuật toán. Giả thuyết sai.

Thứ duy nhất đáng sửa là CÁCH NÓI: màn hình ghi "kỳ vọng −0.54R" — đúng, nhưng
không cho biết là **kế hoạch tự nó đã hỏng**, chứ không phải xác suất xấu. Nay có
thêm một lý do chặn gọi đúng tên: *"TP1 chỉ cách entry 0.043% — gần hơn cả phí
vào-ra 0.120%, kế hoạch không thể có lãi"*.

Điều kiện mới **không lọc thêm kèo nào**, và đã kiểm chứng bằng cách chạy lại đúng
bộ dữ liệu (`full-nen1m-kem-dieu-kien-phi.txt`): PF giống hệt tới hai chữ số ở cả
năm biến thể (0.92 / 0.96 / 1.05 / 1.03 / 0.89). Chênh lệch n dưới 5 trên ~5300 là
do lần tải dữ liệu khác nhau ở mép, không phải do điều kiện mới.

## Ba vế phái sinh: đo được rồi, và câu trả lời là KHÔNG

OI, funding và taker perp chiếm **40 trên 103** trọng số chấm điểm, nhưng backtest
tới nay chạy mù phái sinh nên edge của chúng luôn đo ra 0 — trọng số của chúng là
niềm tin, không phải bằng chứng. Nay lấy được từ kho lưu trữ (`scripts/deriv.ts`,
`bench/phai-sinh.txt`), 5487 lệnh, 6 mã × 15m/1h/4h, nến 1m gỡ thứ tự.

**Tổng thể: không đổi gì cả.**

| | avgR | PF | ngoài mẫu avgR | ngoài mẫu PF |
|---|---:|---:|---:|---:|
| mù phái sinh | −0.05 | 0.89 | −0.10 | 0.79 |
| có phái sinh | −0.05 | 0.89 | −0.10 | 0.79 |

**Từng vế, khi đã có dữ liệu thật:**

| vế | n | edge | đọc |
|---|---:|---:|---|
| Cấu trúc HH/HL/LH/LL | 5080 | +0.16 | ✓ có edge |
| Taker Buy/Sell (spot **+ perp**) | 3232 | +0.08 | ✓ có edge — nhưng **thấp hơn** khi chỉ có spot (+0.11) |
| Open Interest | 1252 | +0.05 | nhiễu |
| Price Action | 5095 | +0.04 | nhiễu |
| Vị trí trong Value Area | 5166 | −0.00 | nhiễu |
| **Funding (ai trả ai)** | 133 | **−0.12** | ✗ **ĐI NGƯỢC** |
| Lịch sử funding | 12 | −0.37 | gần như không bao giờ bắn |

Và phần lệnh **qua cửa** còn **tệ đi**: avgR 0.21 → 0.11, PF 1.59 → 1.26.

### Đã kiểm định giả thuyết "bỏ funding thì tốt hơn" — KHÔNG ĐÚNG

Chọn trên nửa đầu, xác nhận trên nửa sau (`bench/phai-sinh-trong-so.txt`). Tổng
trọng số giữ nguyên 103 ở mọi biến thể, nếu không thì ngưỡng hạng đổi nghĩa.

| biến thể | qua cửa · nửa đầu | qua cửa · **NỬA SAU** |
|---|---:|---:|
| đang chạy (funding 8) | 0.08 | **0.26** |
| bỏ funding (→ taker 28) | 0.12 | **0.21** |
| bỏ funding + OI (→ taker 40) | 0.08 | **0.05** |
| đối chứng: tăng funding ×2 | 0.07 | **0.14** |

Cái đẹp lên trong mẫu (0.08 → 0.12) **đảo chiều** ngoài mẫu (0.26 → 0.21). Và
ngoài mẫu chỉ có **n = 24–27 lệnh** — không con số nào ở cột đó nói được gì.
"Mọi lệnh" thì bốn biến thể giống hệt nhau (−0.01 / −0.10, PF 0.98 / 0.79).

**Kết luận: KHÔNG đổi trọng số.** Đổi trọng số dựa trên 24 lệnh ngoài mẫu đúng
là kiểu uốn tham số mà cả bản audit này tồn tại để tránh.

### Nói thẳng ra thì

Ba vế phái sinh, ở mức trọng số hiện tại, **không làm được việc gì đo được**.
Vế funding còn chỉ sai hướng, chỉ là mẫu quá nhỏ để hành động. Hệ thống thật ra
đơn giản hơn cái nó tự mô tả: gần như toàn bộ tín hiệu đo được nằm ở **cấu trúc**
và **taker flow**.

Một giới hạn phải nêu: cửa chất lượng lọc chặt tới mức nửa sau của mẫu chỉ còn
24 lệnh qua cửa. Mọi kết luận về "kèo qua cửa" đều đứng trên nền mẫu mỏng đó, bất
kể trọng số thế nào.

## Nến spot hay nến perp? — đo rồi, không đáng đổi

Hệ khuyến nghị lệnh trên **perp**, nhưng cả đường live lẫn backtest đều dựng
volume profile, price action, cấu trúc và mọi mức giá từ nến **spot**
(`scan.ts` gọi `fetchKlines` trên SPOT base). Nên backtest **không sai so với
live** — cả hai cùng lệch một kiểu. Câu hỏi là chỗ lệch đó có đổi kết quả không.

`scripts/market.ts` đổi **đúng một biến**: nguồn nến. Giao hai chuỗi theo
timestamp để hai bên có đúng cùng những cây nến; nến 1m gỡ thứ tự cũng lấy đúng
chợ đang mô phỏng.

Hai chợ khác nhau: giá đóng lệch trung bình **0.0515%** (lớn nhất 0.46%), nhưng
volume perp gấp **8.10×** volume spot — tức volume profile được dựng từ hai phân
bố rất khác nhau.

| | mù phái sinh | | có phái sinh | |
|---|---:|---:|---:|---:|
| | **spot** | **perp** | **spot** | **perp** |
| mọi lệnh · avgR | −0.05 | −0.06 | −0.05 | −0.07 |
| mọi lệnh · PF | 0.89 | 0.87 | 0.89 | 0.87 |
| ngoài mẫu · PF | 0.79 | 0.78 | 0.79 | 0.79 |
| qua cửa · avgR | 0.21 | 0.13 | 0.11 | 0.09 |
| qua cửa · n | 156 | 176 | 145 | 150 |
| qua cửa ngoài mẫu · avgR | 0.18 (n=26) | 0.14 (n=48) | 0.26 (n=24) | **0.32 (n=38)** |

**Kết luận: không đổi.** Perp không tốt hơn ở bất kỳ cột nào có đủ mẫu, và hơi
tệ hơn ở tổng thể. Ô duy nhất perp thắng (qua cửa ngoài mẫu, có phái sinh) có
n=38 và **đảo chiều** khi chạy mù phái sinh trên cùng dữ liệu — chính sự bất ổn
đó là bằng chứng ô đó là nhiễu.

Một điểm nhất quán ở cả hai cấu hình: nến perp cho **nhiều** kèo qua cửa hơn
nhưng **avgR thấp hơn**, tức nó làm cửa bớt chọn lọc. Ghi lại để biết, không đủ
để hành động.

Chỗ lệch spot/perp vì thế là một lo lắng **đã được gỡ**, không phải một lỗi cần sửa.

## Giới hạn còn lại

- Backtest **mù phái sinh** đã hết là giới hạn — nay đo được (xem mục trên). Giới
  hạn mới là mẫu: vế funding chỉ bắn 133 lần trên 5487 lệnh.
- Nến dùng là **spot** trong khi hệ khuyến nghị trên perp — đã đo, không đổi kết
  quả (xem mục trên). Đây là đặc điểm đã biết, không còn là ẩn số.
- Nến 1m gỡ được tới mức phút; trong chính phút đó vẫn giữ giả định phía xấu.
