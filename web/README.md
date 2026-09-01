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
npm test        # 39 unit test
npm run build   # production build
npm run start
```

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
