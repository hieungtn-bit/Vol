import { cached, DEFAULT_TTL } from './cache';
import type { Candle, TF } from './types';

// ============================================================
// Nguồn dữ liệu. Không API key. Không scrape.
//   spot  : data-api.binance.vision  (fallback api.binance.com)
//   perp  : fapi.binance.com — hay 451/403 từ VPS US/EU
//   okx   : www.okx.com public v5 — funding, mark, open interest
// Không có gì thì trả null. KHÔNG bịa số.
// ============================================================

const SPOT = process.env.BINANCE_SPOT_BASE ?? 'https://data-api.binance.vision';
const SPOT_FALLBACK = process.env.BINANCE_SPOT_FALLBACK ?? 'https://api.binance.com';
const FAPI = process.env.BINANCE_FAPI_BASE ?? 'https://fapi.binance.com';
const OKX = process.env.OKX_BASE ?? 'https://www.okx.com';

const UA = { 'User-Agent': 'market-scan-multi-tf/1.0' };

export class GeoBlocked extends Error {}

/** Trạng thái các venue trong lần scan hiện tại — hiển thị ra UI, không giấu. */
export const venueState = {
  perpAlive: null as boolean | null,
  perpReason: '' as string,
};

async function getJSON<T>(url: string, timeoutMs = 9000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal, cache: 'no-store' });
    if (r.status === 451 || r.status === 403) {
      throw new GeoBlocked(`HTTP ${r.status} từ ${new URL(url).host}`);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} từ ${new URL(url).host}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

// ---------------- Spot klines ----------------

const INTERVAL: Record<TF, string> = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };

export const TF_MS: Record<TF, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

type RawKline = [number, string, string, string, string, string, number, string, number, string, string, string];

function toCandles(raw: RawKline[], tfMs: number): Candle[] {
  const now = Date.now();
  return raw.map((k) => ({
    t: k[0],
    o: +k[1],
    h: +k[2],
    l: +k[3],
    c: +k[4],
    v: +k[5],
    q: +k[7],
    // field 9 = taker buy base asset volume. CHỢ NÀO thì tuỳ endpoint gọi nó:
    // /api/v3/klines → taker SPOT; /fapi/v1/klines → taker PERP. Nhãn phải đi
    // theo nguồn, không theo chỗ dùng.
    takerBuyBase: k[9] !== undefined ? +k[9] : null,
    closed: k[0] + tfMs <= now,
  }));
}

export async function fetchKlines(symbol: string, tf: TF, limit = 500): Promise<Candle[]> {
  const path = `/api/v3/klines?symbol=${symbol}&interval=${INTERVAL[tf]}&limit=${limit}`;
  return cached(`kl:${symbol}:${tf}:${limit}`, DEFAULT_TTL, async () => {
    try {
      return toCandles(await getJSON<RawKline[]>(SPOT + path), TF_MS[tf]);
    } catch {
      return toCandles(await getJSON<RawKline[]>(SPOT_FALLBACK + path), TF_MS[tf]);
    }
  });
}

/** Gương của FAPI qua www.binance.com — hay sống khi fapi.binance.com bị chặn. */
const FAPI_WWW = process.env.BINANCE_FAPI_WWW ?? 'https://www.binance.com/fapi';

/**
 * NẾN USD-M PERP. Người dùng vào lệnh trên perp, nên value area, H8, H11 và giá
 * hiện tại đều phải đọc từ SỔ PERP. Nến spot lệch khỏi perp đúng ở những lúc
 * quan trọng nhất (funding, squeeze, thanh lý).
 *
 * Ba tầng, và tầng ba PHẢI được báo ra ngoài chứ không nuốt:
 *   1. www.binance.com/fapi — gương, thường sống khi fapi.binance.com bị chặn
 *   2. fapi.binance.com     — sổ gốc
 *   3. spot                 — chỉ để trang còn chạy; `nguon` trả về 'spot' để
 *      phía gọi ghi vào degraded. Không được im lặng coi spot là perp.
 */
export async function fetchKlinesPerp(
  symbol: string, tf: TF, limit = 500,
): Promise<{ candles: Candle[]; nguon: 'perp-www' | 'perp-fapi' | 'spot'; loi: string | null }> {
  const path = `/fapi/v1/klines?symbol=${symbol}&interval=${INTERVAL[tf]}&limit=${limit}`;
  return cached(`klp:${symbol}:${tf}:${limit}`, DEFAULT_TTL, async () => {
    const loi: string[] = [];
    try {
      const r = await getJSON<RawKline[]>(`${FAPI_WWW}${path.replace('/fapi/v1/', '/v1/')}`, 12_000);
      if (r.length) return { candles: toCandles(r, TF_MS[tf]), nguon: 'perp-www' as const, loi: null };
      loi.push('www rỗng');
    } catch (e) { loi.push(`www: ${(e as Error).message}`); }
    try {
      const r = await getJSON<RawKline[]>(`${FAPI}${path}`, 12_000);
      if (r.length) return { candles: toCandles(r, TF_MS[tf]), nguon: 'perp-fapi' as const, loi: null };
      loi.push('fapi rỗng');
    } catch (e) { loi.push(`fapi: ${(e as Error).message}`); }

    const spot = await fetchKlines(symbol, tf, limit);
    return {
      candles: spot,
      nguon: 'spot' as const,
      loi: `nến perp chết (${loi.join(' · ')}) — đang dùng nến SPOT cho ${tf}, `
        + 'value area / H8 / H11 / giá đều lệch khỏi sổ perp.',
    };
  });
}

/**
 * Tải NHIỀU nến lịch sử bằng cách phân trang lùi. Binance trả tối đa 1000 nến mỗi
 * lần, nên muốn vài nghìn nến cho backtest thì phải đi từng trang.
 *
 * KHÔNG dùng cache: backtest chạy một lần với chuỗi dài, cache chỉ tổ phình bộ nhớ.
 */
export async function fetchKlinesHistory(
  symbol: string,
  tf: TF,
  bars: number,
): Promise<Candle[]> {
  const step = TF_MS[tf];
  const out: Candle[] = [];
  let endTime = Date.now();

  while (out.length < bars) {
    const want = Math.min(1000, bars - out.length);
    const path =
      `/api/v3/klines?symbol=${symbol}&interval=${INTERVAL[tf]}&limit=${want}&endTime=${endTime}`;
    let raw: RawKline[];
    try {
      raw = await getJSON<RawKline[]>(SPOT + path, 20_000);
    } catch {
      raw = await getJSON<RawKline[]>(SPOT_FALLBACK + path, 20_000);
    }
    if (raw.length === 0) break;
    out.unshift(...toCandles(raw, step));
    endTime = raw[0][0] - 1;
    if (raw.length < want) break;   // hết lịch sử
  }

  // Nến cuối có thể chưa đóng — backtest chỉ được dùng nến đã đóng.
  return out.filter((c) => c.closed);
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
}

export async function fetchAllTickers(): Promise<Ticker24h[]> {
  return cached('tickers24', Math.max(DEFAULT_TTL, 30_000), async () => {
    const url = '/api/v3/ticker/24hr';
    let raw: any[];
    try {
      raw = await getJSON<any[]>(SPOT + url, 20_000);
    } catch {
      raw = await getJSON<any[]>(SPOT_FALLBACK + url, 20_000);
    }
    return raw.map((t) => ({
      symbol: t.symbol as string,
      lastPrice: +t.lastPrice,
      priceChangePercent: +t.priceChangePercent,
      quoteVolume: +t.quoteVolume,
      highPrice: +t.highPrice,
      lowPrice: +t.lowPrice,
    }));
  });
}

export async function fetchTicker(symbol: string): Promise<Ticker24h | null> {
  return cached(`t24:${symbol}`, DEFAULT_TTL, async () => {
    const url = `/api/v3/ticker/24hr?symbol=${symbol}`;
    try {
      const t = await getJSON<any>(SPOT + url);
      return {
        symbol: t.symbol, lastPrice: +t.lastPrice, priceChangePercent: +t.priceChangePercent,
        quoteVolume: +t.quoteVolume, highPrice: +t.highPrice, lowPrice: +t.lowPrice,
      };
    } catch {
      return null;
    }
  });
}

// ---------------- Perp: Binance fapi (hay bị chặn) ----------------

export interface PerpSnapshot {
  alive: boolean;
  reason: string;
  fundingRate: number | null;
  /** Các kỳ funding ĐÃ CHỐT, cũ → mới. null khi không lấy được. */
  fundingHistory: number[] | null;
  nextFundingTime: number | null;
  markPrice: number | null;
  openInterest: number | null;   // base coin
  oiHist: { t: number; oi: number }[] | null;
  /** OI quy ra USD notional — để so với volume perp cùng chợ. */
  oiUsd: number | null;
  /** Volume 24h của CHÍNH chợ perp này (USDT). */
  vol24hUsd: number | null;
  /** Giá cuối 24h ticker PERP. Dùng khi markPrice thiếu. */
  lastPrice: number | null;
  /** Cao/thấp 24h của SỔ PERP — H11 phải đo trên sổ mà lệnh sẽ khớp. */
  high24h: number | null;
  low24h: number | null;
}

export async function fetchBinancePerp(symbol: string): Promise<PerpSnapshot> {
  return cached(`perp:${symbol}`, DEFAULT_TTL, async () => {
    const dead = (reason: string): PerpSnapshot => {
      venueState.perpAlive = false;
      venueState.perpReason = reason;
      return {
        alive: false, reason, fundingRate: null, fundingHistory: null, nextFundingTime: null,
        markPrice: null, openInterest: null, oiHist: null, oiUsd: null, vol24hUsd: null,
        lastPrice: null, high24h: null, low24h: null,
      };
    };
    try {
      const [pi, oi, t24, fh] = await Promise.all([
        getJSON<any>(`${FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`),
        getJSON<any>(`${FAPI}/fapi/v1/openInterest?symbol=${symbol}`).catch(() => null),
        // Volume 24h của chính chợ perp — mẫu số duy nhất hợp lệ cho tỷ lệ OI/vol.
        getJSON<any>(`${FAPI}/fapi/v1/ticker/24hr?symbol=${symbol}`).catch(() => null),
        // Lịch sử funding: rate hiện tại không nói được "đã kéo dài bao lâu".
        getJSON<any[]>(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&limit=12`).catch(() => null),
      ]);
      const fundingHistory = Array.isArray(fh)
        ? fh.map((x) => Number(x.fundingRate)).filter((x) => Number.isFinite(x))
        : null;
      let oiHist: { t: number; oi: number }[] | null = null;
      let oiUsd: number | null = null;
      try {
        const h = await getJSON<any[]>(
          `${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=25`,
        );
        oiHist = h.map((x) => ({ t: +x.timestamp, oi: +x.sumOpenInterest }));
        const lastVal = h[h.length - 1]?.sumOpenInterestValue;
        if (lastVal != null) oiUsd = +lastVal;
      } catch { /* openInterestHist có thể tắt riêng — không sao */ }

      const mark = pi?.markPrice != null ? +pi.markPrice : null;
      if (oiUsd == null && oi?.openInterest != null && mark) oiUsd = +oi.openInterest * mark;

      venueState.perpAlive = true;
      return {
        alive: true,
        reason: 'binance-fapi',
        fundingRate: pi?.lastFundingRate != null ? +pi.lastFundingRate : null,
        fundingHistory,
        nextFundingTime: pi?.nextFundingTime != null ? +pi.nextFundingTime : null,
        markPrice: mark,
        openInterest: oi?.openInterest != null ? +oi.openInterest : null,
        oiHist,
        oiUsd,
        vol24hUsd: t24?.quoteVolume != null ? +t24.quoteVolume : null,
        lastPrice: t24?.lastPrice != null ? +t24.lastPrice : null,
        high24h: t24?.highPrice != null ? +t24.highPrice : null,
        low24h: t24?.lowPrice != null ? +t24.lowPrice : null,
      };
    } catch (e) {
      if (e instanceof GeoBlocked) return dead(`Binance perp bị chặn (${e.message}) → dùng OKX.`);
      return dead(`Binance perp không phản hồi (${(e as Error).message}) → dùng OKX.`);
    }
  });
}

/** Taker buy/sell của PERP. Chỉ sống khi fapi sống — nếu không thì N/A, không thay bằng spot. */
export async function fetchPerpTakerRatio(
  symbol: string,
  period = '15m',
): Promise<{ buy: number; sell: number }[] | null> {
  if (venueState.perpAlive === false) return null;
  return cached(`perptaker:${symbol}:${period}`, DEFAULT_TTL, async () => {
    try {
      const r = await getJSON<any[]>(
        `${FAPI}/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=48`,
      );
      return r.map((x) => ({ buy: +x.buyVol, sell: +x.sellVol }));
    } catch {
      return null;
    }
  });
}

// ---------------- OKX public ----------------

export function okxInst(symbol: string): string {
  const base = symbol.replace(/USDT$/, '');
  return `${base}-USDT-SWAP`;
}

export interface OkxSnapshot {
  ok: boolean;
  fundingRate: number | null;
  nextFundingTime: number | null;
  markPrice: number | null;
  oiUsd: number | null;
  oiHistUsd: { t: number; oi: number }[] | null;
  /** Volume 24h của CHÍNH chợ perp này (USD). Để so OI/vol cùng venue, không trộn spot. */
  perpVol24hUsd: number | null;
}

export async function fetchOkx(symbol: string): Promise<OkxSnapshot> {
  const inst = okxInst(symbol);
  const ccy = symbol.replace(/USDT$/, '');
  return cached(`okx:${symbol}`, DEFAULT_TTL, async () => {
    const out: OkxSnapshot = {
      ok: false, fundingRate: null, nextFundingTime: null,
      markPrice: null, oiUsd: null, oiHistUsd: null, perpVol24hUsd: null,
    };
    const [fr, mark, oi, hist] = await Promise.allSettled([
      getJSON<any>(`${OKX}/api/v5/public/funding-rate?instId=${inst}`),
      getJSON<any>(`${OKX}/api/v5/public/mark-price?instType=SWAP&instId=${inst}`),
      getJSON<any>(`${OKX}/api/v5/public/open-interest?instId=${inst}`),
      getJSON<any>(`${OKX}/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1H`),
    ]);

    if (fr.status === 'fulfilled' && fr.value?.data?.[0]) {
      out.fundingRate = +fr.value.data[0].fundingRate;
      out.nextFundingTime = +fr.value.data[0].fundingTime;
      out.ok = true;
    }
    if (mark.status === 'fulfilled' && mark.value?.data?.[0]) {
      out.markPrice = +mark.value.data[0].markPx;
      out.ok = true;
    }
    if (oi.status === 'fulfilled' && oi.value?.data?.[0]?.oiUsd) {
      out.oiUsd = +oi.value.data[0].oiUsd;
      out.ok = true;
    }
    if (hist.status === 'fulfilled' && Array.isArray(hist.value?.data)) {
      // [ts, oiUsd, volUsd] — mới nhất đứng đầu
      const rows = (hist.value.data as string[][])
        .map((r) => ({ t: +r[0], oi: +r[1], vol: +r[2] }))
        .sort((a, b) => a.t - b.t);
      out.oiHistUsd = rows.map(({ t, oi }) => ({ t, oi }));
      const last24 = rows.slice(-24);
      if (last24.length >= 12) {
        out.perpVol24hUsd = last24.reduce((sum, r) => sum + (isFinite(r.vol) ? r.vol : 0), 0);
      }
      out.ok = true;
    }
    return out;
  });
}

/**
 * Ai đang ĐỨNG ở phía nào (khác với ai đang ĐÁNH — đó là taker ratio).
 *  - globalLongShortAccountRatio: đếm theo TÀI KHOẢN, nên nghiêng về bán lẻ.
 *  - topLongShortPositionRatio: theo GIÁ TRỊ vị thế của nhóm tài khoản lớn.
 * Hai số này hay ngược nhau, và chỗ ngược nhau mới là chỗ đáng đọc.
 */
export interface PerpPositioning {
  retailLongPct: number | null;
  topLongPct: number | null;
}

export async function fetchPerpPositioning(
  symbol: string,
  period = '15m',
): Promise<PerpPositioning> {
  if (venueState.perpAlive === false) return { retailLongPct: null, topLongPct: null };
  return cached(`pos:${symbol}:${period}`, DEFAULT_TTL, async () => {
    // Cả hai endpoint đều trả field tên `longAccount` — kể cả endpoint "position",
    // nơi con số thực ra là tỷ trọng GIÁ TRỊ VỊ THẾ chứ không phải số tài khoản.
    // Tên field gây hiểu nhầm, nên thử `longPosition` trước rồi mới rơi về
    // `longAccount`; không có vế nào thì trả null chứ không đoán.
    const pick = async (path: string, keys: string[]): Promise<number | null> => {
      try {
        const r = await getJSON<any[]>(`${FAPI}${path}?symbol=${symbol}&period=${period}&limit=1`);
        const row = r?.[r.length - 1];
        if (!row) return null;
        for (const k of keys) {
          const v = row[k];
          if (v != null && isFinite(+v)) return +v;
        }
        return null;
      } catch {
        return null;
      }
    };
    // Giá trị trả về là tỷ lệ 0–1.
    const [retail, top] = await Promise.all([
      pick('/futures/data/globalLongShortAccountRatio', ['longAccount']),
      pick('/futures/data/topLongShortPositionRatio', ['longPosition', 'longAccount']),
    ]);
    return {
      retailLongPct: retail != null ? retail * 100 : null,
      topLongPct: top != null ? top * 100 : null,
    };
  });
}

export const SOURCES = { SPOT, SPOT_FALLBACK, FAPI, OKX };
