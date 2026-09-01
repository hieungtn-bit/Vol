import { NextResponse } from 'next/server';
import { ALWAYS_INCLUDE, DEFAULT_MIN_QUOTE_VOL, isEligible, MAX_SCAN_SYMBOLS } from '@/config/universe';
import { fetchAllTickers } from '@/lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minQuoteVol = Number(url.searchParams.get('minVol') ?? DEFAULT_MIN_QUOTE_VOL);
  const includeEquity = url.searchParams.get('equity') === '1';
  const extra = (url.searchParams.get('extra') ?? '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

  try {
    const tickers = await fetchAllTickers();
    const filter = { minQuoteVol, includeEquity, extraSymbols: extra };

    const eligible = tickers
      .filter((t) => isEligible(t.symbol, t.quoteVolume, filter))
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    const map = new Map(tickers.map((t) => [t.symbol, t]));
    const pinned = [...ALWAYS_INCLUDE, ...extra].filter((s) => map.has(s));

    const seen = new Set<string>();
    const out: { symbol: string; quoteVolume: number; lastPrice: number; change: number; pinned: boolean }[] = [];
    for (const s of pinned) {
      if (seen.has(s)) continue;
      seen.add(s);
      const t = map.get(s)!;
      out.push({ symbol: s, quoteVolume: t.quoteVolume, lastPrice: t.lastPrice, change: t.priceChangePercent, pinned: true });
    }
    for (const t of eligible) {
      if (seen.has(t.symbol) || out.length >= MAX_SCAN_SYMBOLS) continue;
      seen.add(t.symbol);
      out.push({ symbol: t.symbol, quoteVolume: t.quoteVolume, lastPrice: t.lastPrice, change: t.priceChangePercent, pinned: false });
    }

    return NextResponse.json({ ok: true, minQuoteVol, includeEquity, count: out.length, symbols: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, symbols: [] }, { status: 502 });
  }
}
