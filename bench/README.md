# Đo lại sau khi sửa hai lỗi mô phỏng

Cùng dữ liệu, cùng lệnh, chỉ khác code mô phỏng.

    npx tsx scripts/backtest.ts --symbols BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT --tf 1h --bars 3000

- `1h-3000-truoc-sua.txt` — commit 148574f (còn cả hai lỗi)
- `1h-3000-sau-sua.txt`   — commit bf0be29 (đã sửa)

Hai lần chạy tải dữ liệu riêng nên số nến lệch nhau vài nến ở mép; chênh lệch
dưới đây lớn hơn hẳn mức đó nên không phải do dữ liệu.

## Toàn mẫu

| biến thể                    | avgR trước | avgR sau  | PF trước | PF sau |
|-----------------------------|-----------:|----------:|---------:|-------:|
| gốc (không cửa nào)         |     +0.07  | **−0.05** |     1.16 | **0.89** |
| cửa cũ (nhất trí+≥B+Rkv≤1.5)|     +0.11  | **−0.00** |     1.35 | **0.99** |
| cửa mới (+ phí ≤ 10% của 1R)|     +0.14  | **+0.05** |     1.46 | **1.12** |
| cửa mới + SL ≥ 1.5%         |     +0.19  | **+0.12** |     1.62 | **1.35** |

## Ngoài mẫu (nửa sau theo thời gian)

| biến thể                    | avgR trước | avgR sau  | PF trước | PF sau |
|-----------------------------|-----------:|----------:|---------:|-------:|
| gốc                         |     +0.01  | **−0.10** |     1.02 | **0.80** |
| cửa cũ                      |     +0.14  | **+0.00** |     1.46 | **1.01** |
| cửa mới                     |     +0.14  | **+0.04** |     1.51 | **1.11** |
| cửa mới + SL ≥ 1.5%         |     +0.21  | **+0.15** |     1.75 | **1.45** |

## Đọc kết quả

Hai lỗi mô phỏng cộng thêm khoảng **+0.12R mỗi lệnh** không có thật — tức là
phần lớn cái "edge" từng đo được.

Sau khi sửa:

- Hệ **không có cửa chất lượng là hệ THUA** (PF 0.89, ngoài mẫu 0.80). Trước đây
  nó hiện ra là hệ thắng nhẹ. Đây là thay đổi kết luận, không phải thay đổi con số.
- Cửa cũ chỉ đưa hệ về hoà vốn (PF 0.99), không tạo ra lợi thế.
- Chỉ hai cửa chặt nhất còn dương, và cũng chỉ còn hơn nửa mức từng báo cáo.

Mọi con số avgR/PF ghi trong tài liệu trước commit bf0be29 đều phải bỏ.
