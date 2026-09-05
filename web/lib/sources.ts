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
    // field 9 = taker buy base asset volume → taker delta THẬT, nhưng là của SPOT.
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
  nextFundingTime: number | null;
  markPrice: number | null;
  openInterest: number | null;   // base coin
  oiHist: { t: number; oi: number }[] | null;
  /** OI quy ra USD notional — để so với volume perp cùng chợ. */
  oiUsd: number | null;
  /** Volume 24h của CHÍNH chợ perp này (USDT). */
  vol24hUsd: number | null;
}

export async function fetchBinancePerp(symbol: string): Promise<PerpSnapshot> {
  return cached(`perp:${symbol}`, DEFAULT_TTL, async () => {
    const dead = (reason: string): PerpSnapshot => {
      venueState.perpAlive = false;
      venueState.perpReason = reason;
      return {
        alive: false, reason, fundingRate: null, nextFundingTime: null,
        markPrice: null, openInterest: null, oiHist: null, oiUsd: null, vol24hUsd: null,
      };
    };
    try {
      const [pi, oi, t24] = await Promise.all([
        getJSON<any>(`${FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`),
        getJSON<any>(`${FAPI}/fapi/v1/openInterest?symbol=${symbol}`).catch(() => null),
        // Volume 24h của chính chợ perp — mẫu số duy nhất hợp lệ cho tỷ lệ OI/vol.
        getJSON<any>(`${FAPI}/fapi/v1/ticker/24hr?symbol=${symbol}`).catch(() => null),
      ]);
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
        nextFundingTime: pi?.nextFundingTime != null ? +pi.nextFundingTime : null,
        markPrice: mark,
        openInterest: oi?.openInterest != null ? +oi.openInterest : null,
        oiHist,
        oiUsd,
        vol24hUsd: t24?.quoteVolume != null ? +t24.quoteVolume : null,
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
    const pick = async (path: string, key: string): Promise<number | null> => {
      try {
        const r = await getJSON<any[]>(`${FAPI}${path}?symbol=${symbol}&period=${period}&limit=1`);
        const v = r?.[r.length - 1]?.[key];
        return v != null ? +v : null;
      } catch {
        return null;
      }
    };
    // longAccount/longPosition đã là tỷ lệ 0–1
    const [retail, top] = await Promise.all([
      pick('/futures/data/globalLongShortAccountRatio', 'longAccount'),
      pick('/futures/data/topLongShortPositionRatio', 'longPosition'),
    ]);
    return {
      retailLongPct: retail != null ? retail * 100 : null,
      topLongPct: top != null ? top * 100 : null,
    };
  });
}

export const SOURCES = { SPOT, SPOT_FALLBACK, FAPI, OKX };
