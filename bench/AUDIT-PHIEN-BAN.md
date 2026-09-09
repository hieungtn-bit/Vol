# Audit lại việc chọn phiên bản

Câu hỏi: **version nào thật sự tốt nhất mà vẫn đủ tín hiệu**, xác định bằng số
liệu chứ không theo cảm giác.

Trả lời ngắn: bảng số liệu đã dùng để chọn `84435f4` **không so được** — nó đối
chiếu hai thuật toán khác nhau, đo bằng hai script khác nhau, trên một bộ mô
phỏng có hai lỗi. Nhưng sau khi đo lại cho đúng, **kết luận cuối vẫn đứng**, chỉ
là vì lý do khác và với con số khác.

## Cách đo

Muốn so ENGINE thì bộ mô phỏng phải giống nhau ở mọi bản. Để nguyên hai lỗi cũ
là cho bản cũ hưởng đúng **+0.12R mỗi lệnh không có thật**.

Nên: tạo worktree cho từng commit, áp **đúng hai bản sửa mô phỏng** (khớp lệnh ở
giá nến chưa in ra; chốt lời trên chính nến vào lệnh), không đụng gì khác, mỗi
bước có `assert` và `grep` xác nhận sau khi ghi. Rồi chạy cùng một lệnh, cùng dữ
liệu: 6 mã × 15m/1h/4h × 3000 nến.

## Phát hiện 1 — ba "version" đó dùng CHUNG một engine

| file | 84435f4 vs 947e417 vs 85a5314 |
|---|---|
| `lib/direct.ts` | **giống hệt cả ba** |
| `lib/decide.ts` | **giống hệt cả ba** |
| `lib/analyze.ts` | **giống hệt cả ba** |
| `scripts/backtest.ts` | **giống hệt cả ba** |
| `lib/volumeProfile.ts` | khác — nhưng chỉ thêm tuỳ chọn `minBins` có mặc định giữ nguyên hành vi |

Chạy cả ba dưới bộ mô phỏng đã sửa cho ra kết quả **giống nhau tới từng chữ số**:

    n=5476   win 48.6%   avgR −0.09   PF 0.83

Ba commit đó **không phải ba phiên bản thuật toán**. Trên đường code mà production
dùng, chúng là **một**.

## Phát hiện 2 — bảng cũ so hai thuật toán khác nhau, không phải ba version

| dòng trong bảng cũ | thật ra đo cái gì |
|---|---|
| `84435f4` — 603 tín hiệu | engine cũ, qua `scripts/backtest.ts` |
| `947e417` / `28a9318` — **0** tín hiệu | **thước mới**, qua `backtestNew.ts` |
| `85a5314` — 182 tín hiệu, PF 0.62 | **thước mới**, qua `backtestArchive.ts` |

Nên quyết định "quay lại `84435f4`" thật ra là quyết định **"giữ engine cũ, bỏ
thước mới"**. Đó có thể là quyết định đúng, nhưng nó không phải thứ mà bảng số
liệu kia chứng minh.

## Phát hiện 3 — "thước mới ra 0 lệnh" là kết luận đo trong điều kiện nó không chạy được

Chạy lại thước mới dưới bộ mô phỏng đã sửa (`bench/audit-thuoc-moi.txt`):

    ≥ 6.5   3224 nến   (8.20%)
    ≥ 7        0 nến   (0.00%)   ← sàn điểm

    VÌ SAO CÁC NẾN CÒN LẠI ĐỨNG NGOÀI
      Thiếu dữ liệu bắt buộc (taker perp, funding)   39336   (100.0% số nến)

**100% số nến bị loại vì thiếu taker perp và funding.** Thước mới BẮT BUỘC phải
có phái sinh, mà backtest lúc đó chạy mù phái sinh. Trần điểm 6.5 < sàn 7 một
phần chính là vì các vế phái sinh luôn đóng góp 0.

Tức "thước mới vô dụng" là kết luận rút ra từ một lần đo đã **tháo mất đầu vào bắt
buộc** của nó. Đó chưa phải một lần kiểm chứng công bằng.

Nay đã có phái sinh lịch sử (`lib/archiveDeriv.ts`), nên thước mới **kiểm chứng
lại được** — việc đó chưa làm.

## Phát hiện 4 — con số dùng để chọn không tái lập được

| | bảng cũ khẳng định | đo lại, mô phỏng đã sửa |
|---|---:|---:|
| cửa đầy đủ · avgR | 0.31 | **0.18** |
| cửa đầy đủ · PF | 2.16 | **1.49** |
| ngoài mẫu · avgR | 0.39 | **0.31** |
| ngoài mẫu · PF | 2.86 | **2.14** |

Bị thổi phồng, nhưng **không sụp**. Cửa chất lượng của `84435f4` vẫn dương rõ, và
ngoài mẫu vẫn PF 2.14.

## Phát hiện 5 — cửa của tôi CHẶT HƠN CẦN THIẾT, và đó là cái giá phải nói ra

| cấu hình | n (cửa) | avgR | tổng R | ngoài mẫu |
|---|---:|---:|---:|---|
| **`84435f4` — cửa 4 điều kiện** | **384** | 0.18 | **69.2R** | avgR **0.31** · PF 2.14 · **n=192** |
| v1 = `84435f4` + 6 bản sửa | 149 | 0.24 | 36.3R | avgR 0.35 · PF 2.25 · n=28 |
| v2 = v1 + trọng số theo bằng chứng | 138 | 0.23 | 31.2R | avgR 0.19 · PF 1.54 · n=28 |

Thay `Rkv ≤ 1.5` bằng `kỳ vọng ≥ 0` đã cắt **61% số lệnh** và **48% tổng R**, đổi
lại avgR mỗi lệnh nhích lên 0.18 → 0.24.

Quan trọng hơn con số: cửa cũ có **n=192 ngoài mẫu**, cửa của tôi chỉ **n=28**.
Gấp bảy lần bằng chứng. avgR 0.31 trên n=192 là một con số nói được điều gì đó;
avgR 0.35 trên n=28 (sai số ±0.20) thì không.

## Kết luận

**Bản tốt nhất mà vẫn đủ tín hiệu, tính tới lúc này, là `84435f4` với cửa 4 điều
kiện nguyên bản** — không phải vì nó thắng ở avgR, mà vì nó là cấu hình duy nhất
vừa dương vừa có **đủ mẫu để tin**.

Ba điều kèm theo, phải nói rõ:

1. Quyết định cũ **đúng kết quả nhưng sai lập luận**. Nó chọn đúng bản, dựa trên
   một bảng so hai thuật toán khác nhau bằng hai script khác nhau trên một bộ mô
   phỏng có lỗi.
2. Sáu bản sửa của tôi làm cho **đo đạc đúng hơn** nhưng **cửa chặt hơn mức có
   lợi**. Nên tách hai thứ: giữ các bản sửa mô phỏng và các bản sửa lỗi, nhưng
   xem lại việc thay `Rkv ≤ 1.5` bằng `kỳ vọng ≥ 0`.
3. **Thước mới chưa từng được kiểm chứng công bằng.** Nó bị loại bằng một lần đo
   đã tháo mất đầu vào bắt buộc. Giờ có phái sinh lịch sử rồi thì đó là việc đáng
   làm trước khi kết luận về nó.
