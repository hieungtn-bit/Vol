# Market Scan · Multi-TF

Quét thị trường crypto (Binance USDT spot + phái sinh public) và ra khuyến nghị
**Long / Short / WAIT** cho từng khung **15m · 1h · 4h · 1D**, kèm Entry — Trigger — SL —
TP1 — TP2 — RR — invalidation — 3–6 gạch lý do.

Logic là Price Action + Volume Profile + OI + Funding (+ taker delta khi lấy được).
Không có RSI/MACD. Luật đầy đủ nằm trong [`logic.md`](./logic.md).

**Không phải lời khuyên đầu tư.**

## Chạy local

```bash
cd web
npm install
cp .env.example .env.local     # không bắt buộc, mọi biến đều có mặc định
npm run dev                    # http://localhost:3000
```

Mặc định watchlist là `BTCUSDT, ETHUSDT, ENAUSDT`; bấm **Quét ngay** để ra bảng 4 khung.

```bash
npm test        # 187 unit test
npm run build   # production build
npm run start   # bản này mới có quét nền — xem ngay dưới
```

## Lưu trữ và quét nền

Chạy bằng `npm run start` (hoặc `npm run dev`) thì server tự **quét nền**: nó chạy
tiếp khi bạn đã đóng tab, và ghi lại vào SQLite.

```bash
MARKETSCAN_DB=./data/marketscan.db npm run start
```

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MARKETSCAN_DB` | `./data/marketscan.db` | file CSDL |
| `MARKETSCAN_BACKGROUND` | bật | đặt `0` để tắt quét nền |

**Quét theo nến đóng, không theo đồng hồ.** Mỗi lượt chạy khi nến 15m vừa đóng, cộng
8 giây cho sàn kịp chốt. Quét dày hơn không đẻ ra thông tin mới — mọi đầu vào của
engine đều lấy từ nến đã đóng — mà chỉ đốt rate limit của sàn.

Bốn thứ được lưu: **nến**, **từng lần quét**, **từng tín hiệu** (kèm nguyên văn lý do
bị chặn), và **kết quả backtest** (kèm cấu hình, phạm vi thời gian, sha256 của chính
chuỗi nến đã dùng, và git rev — đủ để chạy lại và đối chiếu).

Xem lại lịch sử:

```
GET /api/scanner                        trạng thái quét nền + trạng thái lưu trữ
GET /api/history                        các lần quét gần đây
GET /api/history?scan=12                mọi tín hiệu của lần quét 12
GET /api/history?symbol=ENAUSDT&tf=1h   hệ đã đổi ý lúc nào trên cặp đó
GET /api/history?backtests=1            các lần backtest đã lưu
```

> **Trên Vercel/serverless thì SQLite và quét nền đều TẮT**, và màn hình nói rõ điều
> đó. Đĩa ở đó là ephemeral: ghi được, đọc lại được vài phút, rồi mất theo instance —
> một file CSDL ở đó là ảo tưởng lưu trữ. Muốn lưu thật thì trỏ `MARKETSCAN_DB` vào ổ
> gắn ngoài. Đây là lý do bản chạy local có nhiều thứ hơn bản trên web.

## Backtest

```bash
npm run backtest -- --symbols ENAUSDT,SOLUSDT --tf 1h --bars 3000
npm run backtest -- --tf 15m,1h,4h --intrabar 1m --save "nhãn của tôi"
```

`--intrabar 1m` tải nến 1 phút từ kho lưu trữ công khai của Binance để **gỡ thứ tự
chạm trong nến** thay vì đoán thận trọng. Không có nó thì khi giá chạm cả stop lẫn
mục tiêu trong một nến, mô phỏng luôn tính stop trước — an toàn, nhưng tính thiếu
khoảng 0.04R mỗi lệnh. File zip được cache ở `.cache/minute/`, lần chạy sau không
tải lại.

`--save` ghi kết quả vào SQLite kèm đủ thứ để chạy lại.

**Đọc kết quả trước khi tin:** [`../bench/README.md`](../bench/README.md) ghi rõ hệ
này đo được gì và chưa đo được gì.

## Cấu trúc

```
web/
├── app/
│   ├── page.tsx                  bảng chính + filter + drawer
│   ├── layout.tsx  globals.css
│   └── api/
│       ├── universe/route.ts     lọc universe theo quote volume 24h
│       ├── scan/route.ts         quét N symbol × 4 TF, lưu snapshot
│       └── snapshots/route.ts    liệt kê / đọc snapshot đã lưu
├── components/
│   ├── SymbolDrawer.tsx          4 card TF, VP mini, funding/OI, checklist, copy plan
│   └── ui.tsx                    badge bias, VP mini, cảnh báo
├── config/universe.ts            NGƯỠNG + DANH SÁCH — sửa ở đây, không sửa engine
├── lib/
│   ├── types.ts                  schema Recommendation & mọi kiểu dữ liệu
│   ├── volumeProfile.ts          computeVolumeProfile, POC, VA70/80, HVN, LVN
│   ├── priceAction.ts            swing, BOS/CHOCH, equal H/L, accept vs grab, ATR
│   ├── derivatives.ts            funding, OI, taker delta / CVD / divergence
│   ├── decide.ts                 decideBias, cổng TF, đặt Entry/SL/TP, chấm điểm, plan text
│   ├── scan.ts                   ghép một symbol: 4 TF + composite + phái sinh
│   ├── sources.ts                gọi exchange, phát hiện 451, fallback OKX
│   ├── cache.ts                  cache TTL + gộp request trùng
│   ├── snapshot.ts               lưu/đọc snapshot JSON
│   └── format.ts                 định dạng giá theo bin, giờ ICT
├── test/                         POC, fail-high, mid-VA, thiếu funding, ngưỡng ≥7
└── .env.example
```

## Nguồn dữ liệu và chuyện Binance chặn IP

| Dữ liệu | Nguồn | Khi hỏng |
|---|---|---|
| Klines 15m/1h/4h/1D, ticker 24h | `data-api.binance.vision` | fallback `api.binance.com` |
| Taker delta | field *taker buy base* của kline **spot** — số thật, gắn nhãn `SPOT` | không có → close-direction, gắn nhãn `PROXY` |
| Funding, mark, Open Interest | `fapi.binance.com` nếu sống; **hầu hết VPS US/EU trả 451** → tự rơi sang OKX public v5 | không có → `N/A` |
| Taker **perp** | `fapi.binance.com` | 451 → `N/A`, **không** thay bằng delta spot |

Khi một nguồn chết, banner "Dữ liệu thiếu" trên trang nói rõ nguồn nào và hệ quả.
Trường nào `N/A` thì **không bao giờ** xuất hiện trong danh sách lý do và không cộng điểm.

CoinGlass chỉ được dùng nếu bạn tự dán key vào `COINGLASS_API_KEY` — không có key thì
OI vẫn lấy từ Binance/OKX public. Không scrape.

## Hai màn hình

| Đường dẫn | Cách kết luận |
|---|---|
| `/` | Kỷ luật: score < 7 → **WAIT**. Dùng khi muốn hệ thống nói thẳng "không có kèo". |
| `/live` | Bản điện: **luôn ra LONG hoặc SHORT, không bao giờ WAIT**, kèm hạng tin cậy A/B/C, tỷ lệ Buy/Sell tách chợ, và funding "ai trả ai". Tự làm mới 60s. |

Hai màn hình dùng **chung một bộ dữ liệu và chung các module phân tích** — chỉ khác ở bước
kết luận cuối. Luật chấm điểm của bản điện nằm ở mục 9 của `logic.md`.

## Chạy liên tục

- `/live` tự làm mới **60 giây** một lần khi đang mở — đây là phần "theo dõi liên tục" thật sự.
- `GET /api/cron/scan` quét rồi lưu snapshot, trả về tóm tắt gọn để đọc thẳng trong log.
  Đặt `CRON_SECRET` thì endpoint đòi header `Authorization: Bearer <secret>`.
- `vercel.json` có khai báo cron, **nhưng gói Hobby của Vercel chỉ bắn 1 lần/ngày** — đó
  không phải "liên tục". Muốn liên tục phía server thì trỏ một scheduler bên ngoài
  (GitHub Actions, cron-job.org, uptime monitor…) vào chính URL đó với chu kỳ mong muốn.

## UI

- **Hàng filter**: min volume 24h, số symbol, thêm symbol thủ công, **Auto 60s**, đồng hồ ICT.
- **Bảng chính**: 1 hàng = 1 symbol · Price · 24h% · Vol · Range pos · 4 badge TF (xanh/đỏ/xám + score).
- **Drawer** (click symbol): 4 card TF đầy đủ kế hoạch, VP mini (POC/VA/HVN/LVN/giá), funding + OI Δ1h/Δ24h,
  bảng điểm hợp lưu, checklist trigger, nút **Copy plan** cho từng TF và cho cả 4 TF.
- Cảnh báo đỏ khi entry rơi vào lõi VA, RR TP1 < 1, hoặc SL > 3% giá.

## Universe

Mặc định: cặp `*USDT` có quote volume 24h ≥ 5 triệu USD, loại leverage token (`*UP/*DOWN/*BULL/*BEAR`),
stablecoin và wrapped equity (bật lại bằng `?equity=1`). `BTCUSDT`, `ETHUSDT`, `ENAUSDT` luôn có mặt.
Sửa ngưỡng và danh sách trong `config/universe.ts`.

## Cái này KHÔNG làm

- Không lấy tin (unlock, listing, "sắp sập") làm trigger — tin chỉ là bối cảnh, và hệ không đọc tin.
- Không gợi ý đòn bẩy, không có "10x". Chỉ có size Small/Normal và rủi ro 0.5–1% tài khoản.
- Không nới SL "cho khỏi bị quét", không kéo TP xa "cho đẹp RR".
- Không hardcode thiên kiến cho bất kỳ symbol nào — ENA chạy đúng engine như BTC.

## Deploy

Vercel project **`market-scan`** (`prj_l1f7VDFM5ibbjZOwhziflWMmVPMx`, team `hieungtn-bits-projects`),
link tới `hieungtn-bit/Vol`, **Root Directory = `web`**. Push là deploy.

### Region — điểm chết người

Region mặc định của Vercel là `iad1` (US East) và **Binance/OKX chặn IP US**. Deploy vào đó
thì mọi call sàn trả 451, trang vẫn lên nhưng chỉ còn WAIT rỗng — hỏng mà trông như chạy tốt.
Đã ghim `sin1` (Singapore) ở hai chỗ, phải giữ cả hai:

- `vercel.json` → `"regions": ["sin1"]`
- `export const preferredRegion = 'sin1'` trong cả ba route handler

### Domain

`maix8.study` (site tĩnh MAIX8 Research, project `writetoearn`) **không dùng chung project với app này** —
app này là Next.js có server, còn `vercel.json` ở gốc Writetoearn hardcode build tĩnh. Hai project riêng.

Gắn `scan.maix8.study`: Vercel → project `market-scan` → Settings → Domains → Add,
rồi bind vào branch `claude/market-scan-multi-tf-wt14mq` (`gitBranch`) — đúng kiểu `maix8.study`
đang bind branch, để push nhánh nào thì domain theo nhánh đó.

### Snapshot

Tự tắt trên serverless (đĩa ephemeral, không giữ được lịch sử) và báo lý do ra banner
"dữ liệu thiếu". Muốn lưu thật thì trỏ `SNAPSHOT_DIR` vào ổ lưu trữ thật.

### Deploy

Project `market-scan` link tới `hieungtn-bit/Vol`, **Root Directory = `web`**, region `sin1`.

**Production hiện vẫn là một deployment proxy mỏng.** Kiểm chứng ngày 05/09: push từ
`claude/market-scan-multi-tf-wt14mq` vẫn tạo deployment `target: null` (preview), và
alias của nó chỉ có branch alias chứ không có `scan.maix8.study`. Nghĩa là Production
Branch của project vẫn chưa trỏ nhánh này.

Lớp proxy: một app Next chỉ có `next.config.mjs`, rewrite `/:path(.*)` sang branch
alias — mà branch alias luôn bám commit mới nhất, nên domain vẫn tự theo code mới.
Hai chi tiết bắt buộc của nó, thiếu là vòng lặp 308:

- `trailingSlash: true` khớp upstream. Lệch nhau thì một bên gỡ dấu `/`, bên kia thêm lại.
- `:path(.*)` chứ **không** `:path*`. `:path*` khớp theo segment nên dừng trước dấu `/`
  cuối: `/strict/` thành `/strict`, upstream 308 trả `/strict/`, quay lại chính proxy.

**Cách bỏ lớp proxy:** Vercel → project **`market-scan`** (không phải `writetoearn`) →
Settings → **Git** → Production Branch → `claude/market-scan-multi-tf-wt14mq` → Save.
Dấu hiệu đã ăn: push kế tiếp cho deployment `target: "production"`, và
`curl -sI https://scan.maix8.study/` trả `x-vercel-id` chỉ còn **một** chặng `iad1`
thay vì ba.
