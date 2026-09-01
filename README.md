# VP-Desk — Volume Profile Desk cho USDT-M Futures

Một file Python duy nhất (`vp_desk.py`) kéo nến futures, dựng Volume Profile, chỉ ra
kháng cự/hỗ trợ **thật** (chỉ từ volume), và xuất kế hoạch lệnh với 4 số bắt buộc:
**Entry — Stop (thesis chết) — TP1 — TP2**.

Không dùng MA/số tròn làm S/R chính. Không đưa lời khuyên cảm tính.
**Không phải khuyến nghị đầu tư.**

---

## 1. Cài đặt

```bash
python3 -m pip install requests
```

Chỉ cần `requests`. Không cần `pandas`/`numpy`, không cần API key
(toàn bộ là market data public).

## 2. Chạy

```bash
# mặc định ENAUSDT
python3 vp_desk.py

# chỉ định symbol + số tiền rủi ro mỗi lệnh (USDT)
python3 vp_desk.py --symbol ENAUSDT --risk 50

# khai vốn tài khoản, hệ tự lấy 1% làm risk
python3 vp_desk.py --symbol ENAUSDT --account 5000

# in thêm JSON tóm tắt ra stderr (để nối vào bot/script khác)
python3 vp_desk.py --symbol ENAUSDT --risk 50 --json

# lưu báo cáo
python3 vp_desk.py --symbol ENAUSDT --risk 50 > ena.md
```

### Tham số

| Cờ | Mặc định | Ý nghĩa |
|---|---|---|
| `--symbol` | `ENAUSDT` | Symbol Binance USDT-M. Tự đổi sang `ENA-USDT-SWAP` nếu phải dùng OKX. |
| `--source` | `auto` | `auto` \| `binance` \| `okx`. `auto` = thử Binance, gặp 451/403 thì rơi sang OKX. |
| `--limit` | `1500` | Số nến 15m (tối đa 1500). |
| `--risk` | — | Rủi ro mỗi lệnh, tính bằng USDT. Dùng để tính `qty`. |
| `--account` | — | Vốn tài khoản USDT. Nếu không khai `--risk` thì lấy 1% của số này. |
| `--position` | — | Vị thế đang mở, xem mục 4. |
| `--json` | tắt | In JSON tóm tắt (verdict + 4 số) ra **stderr**. |

## 3. Nguồn dữ liệu và chuyện Binance chặn IP

Mặc định gọi `https://fapi.binance.com`:

```
/fapi/v1/klines (15m, 1h)   /fapi/v1/ticker/price
/fapi/v1/premiumIndex       /fapi/v1/openInterest
/fapi/v1/depth?limit=20
```

Nếu Binance trả **451/403** (chặn địa lý — rất hay gặp khi chạy trên VPS US/EU),
hệ **tự động** rơi sang OKX swap và ghi rõ điều đó ngay đầu báo cáo.
`data-api.binance.vision` **không** phục vụ futures nên không thay thế được — đừng
mất thời gian thử.

Ép dùng OKX:

```bash
python3 vp_desk.py --symbol ENAUSDT --source okx      # instId = ENA-USDT-SWAP, bar=15m
```

Khác biệt cần biết khi chạy trên OKX:

- Volume hợp đồng đã được quy về **base coin** qua `ctVal` (1 hợp đồng ENA = 10 ENA),
  nên số volume so sánh được với Binance.
- OKX **không** công bố taker buy/sell theo nến → cột *Taker delta* sẽ là `n/a`,
  chỉ còn delta proxy nến xanh/đỏ. Báo cáo nói rõ chỗ này, không giấu.
- Nến chưa đóng (`confirm=0`) bị loại khỏi profile.

Nếu 15m thiếu dữ liệu, hệ tự lấy 5m `limit=1500` rồi resample x3.

## 4. Dán vị thế đang mở

```
--position side:entry:sl:tp:leverage[:size]
```

- `side` — `short` hoặc `long` (bắt buộc)
- `entry` — giá vào (bắt buộc)
- `sl`, `tp`, `leverage`, `size` — tuỳ chọn; để trống bằng `-` nếu muốn bỏ qua giữa chừng

Ví dụ:

```bash
python3 vp_desk.py --symbol ENAUSDT --position short:0.16208:0.162:0.154:10
python3 vp_desk.py --symbol ENAUSDT --position long:0.155:0.149:-:5      # chưa đặt TP
python3 vp_desk.py --symbol ENAUSDT --position short:0.16208              # chỉ có entry
```

Mục **NẾU ĐANG CÓ LỆNH** sẽ trả lời đúng bốn câu hỏi:

1. Entry/SL/TP đang nằm **trong hay ngoài** cụm HVN nào (SL trong node = SL trong nhiễu).
2. Nếu SL nằm trong node → **đẩy ra đâu**, và rủi ro % khi đó là bao nhiêu.
3. TP còn phải xuyên **những bậc nào** trước khi tới (chống target nhảy cóc).
4. **Có được dời SL về entry chưa** — chỉ khi nến 15m đã ĐÓNG qua TP1 **và** giá đã rời
   hẳn khỏi node. Mọi trường hợp khác: giữ nguyên SL.

Không có SL thì hệ nói thẳng đó là cách cháy tài khoản và đưa mức cần đặt ngay.

## 5. Phương pháp

**Bin size** theo giá: `≥1 → 0.01` · `0.1–1 → 0.001` · `0.01–0.1 → 0.0005` · `<0.01 → 0.0001`.
Nếu range 15D chia bin ra hơn 1200 bin (ví dụ BTC giá 6 chữ số), bin được nới theo bước
1/2/5 và ghi chú rõ trong báo cáo.

**Profile** tính trên 15m theo **giá đóng**, kèm bản phụ **range-distribution**
(rải đều volume từ low→high) để đối chiếu POC. Khi hai POC lệch nhau hơn 2 bin,
báo cáo cảnh báo: POC close đang bị vài cây nến khối lượng lớn kéo lệch, phải coi
cả vùng là nhà thay vì bám một con số.

**Cửa sổ**: 15D · 7D · 48H · 24H · 12H · 6H. Mỗi cửa sổ trả POC, Value Area 70%
(mở rộng từ POC, ưu tiên phía có volume lớn hơn), top HVN, LVN, delta, hình dạng
(P / b / D / thin peak).

**HVN** = đỉnh cục bộ có share ≥ 1.2%. Biên node nới từ đỉnh **chỉ khi** volume còn
giảm dần và còn ≥ 50% đỉnh — nhờ vậy node dừng lại ở thung lũng giữa hai node thay vì
nuốt cả range. **LVN** = đáy cục bộ share ≤ 0.8% nằm trong range đã trade.

**Cụm (nhà)** = các HVN của 7D và 24H chồng lấn nhau, gộp lại. Các cụm luôn rời nhau,
nên bản đồ S/R và phần quyết định không bao giờ mâu thuẫn.

**Reject** = nến 15m chạm mép cụm rồi đóng ngược phía node.
**Accept** = 2 nến 15m liên tiếp đóng cùng phía ngoài node.

## 6. Logic ra quyết định

Hệ chỉ xuất `LONG`/`SHORT` khi giá **ở mép nhà** *và* **đã reject**. Các trường hợp còn lại là `WAIT`,
và mỗi trường hợp chặn đúng một lỗi cụ thể:

| Tình huống | Kết luận | Chặn lỗi |
|---|---|---|
| Giá giữa hai nhà volume | WAIT | vào vùng không ai giữ giá, thực chất là đoán |
| Giá giữa thân node | WAIT | "không vào giữa hai nhà" |
| Giá vừa accept, rời node | WAIT | **vào muộn** — đuổi giá |
| Chạm mép nhưng chưa reject | WAIT | **vào sớm** — chạm HVN lần đầu đã nhảy vào |
| Mép + reject, nhưng R:R đến TP2 < 1.0 | WAIT | **thắng ít / thua nhiều** |
| Mép + reject, R:R đủ | LONG/SHORT | — |

Ngay cả khi `WAIT`, báo cáo vẫn in đủ 4 số dưới dạng **lệnh chờ có điều kiện kích hoạt
rõ ràng**, để copy sẵn.

**Đặt số:**

- **Entry** — mép nhà. Giá chưa tới mép → đặt limit tại mép, không đuổi.
- **Stop** — ngoài biên **cả cụm** HVN + 1 bin. Đó là chỗ luận điểm chết (thị trường
  chấp nhận giá bên kia tường), không phải chỗ "vừa đủ đau".
- **TP1** — bậc đầu tiên trước mặt lệnh trên path.
- **TP2** — HVN/POC kế tiếp trên path. Không bao giờ nhảy qua một bậc đang có người đứng.

**Size**: `qty = risk_usdt / |entry − stop|`. Trần đòn bẩy gợi ý là 5x, và báo cáo
tính sẵn đòn bẩy tối đa để mức lỗ khi chạm stop không vượt 8% vốn vị thế.

## 7. Những gì hệ này KHÔNG làm

- Không gọi order wall là kháng cự cứng — order book chỉ được mô tả như imbalance tại
  thời điểm chụp.
- Không nói delta là bid/ask delta thật — luôn ghi rõ là proxy.
- Không bịa volume. Thiếu dữ liệu thì nói thiếu và dừng đúng chỗ.
- Không bảo gồng lỗ, không bảo kéo BE khi giá còn trong HVN.

---

**Không phải khuyến nghị đầu tư.**

---

## Web: Market Scan · Multi-TF

Trong repo còn có `web/` — bản web Next.js của cùng tư tưởng này, nhưng **quét nhiều
symbol** và ra khuyến nghị riêng cho **từng khung 15m / 1h / 4h / 1D** thay vì một
báo cáo 15m cho một mã.

```bash
cd web && npm install && npm run dev     # http://localhost:3000
```

- Luật engine: [`web/logic.md`](./web/logic.md)
- Hướng dẫn và cấu trúc: [`web/README.md`](./web/README.md)

`vp_desk.py` (CLI, một symbol, có phần "nếu đang có lệnh") và `web/` (quét nhiều symbol,
4 khung) dùng chung triết lý — chỉ vào ở mép nhà volume, WAIT là kết luận hợp lệ, không
bịa số — nhưng là hai công cụ độc lập, không chia sẻ code.
