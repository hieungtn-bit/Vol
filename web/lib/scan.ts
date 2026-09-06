import { ictSessionStart } from './format';
import { analyzePriceAction, atr } from './priceAction';
import { buildDelta, buildDerivatives } from './derivatives';
import { type HTFContext } from './decide';
import { type DirectionalCall } from './direct';
import { decideBoth, prepareTF } from './analyze';
import { type MarketStructure } from './structure';
import { buildFlow, type FlowInfo } from './flow';
import {
  fetchBinancePerp, fetchKlines, fetchOkx, fetchPerpPositioning, fetchPerpTakerRatio,
  fetchTicker, SOURCES, TF_MS, venueState,
} from './sources';
import { computeVolumeProfile } from './volumeProfile';
import type {
  Candle, CompositeProfiles, Recommendation, SymbolScan, TF, VolumeProfile,
} from './types';
import { TFS } from './types';

// Cửa sổ profile của từng TF: đủ dài để có hình, đủ ngắn để VA còn nói về
// vùng giá thị trường ĐANG chấp nhận. Profile 1h kéo 6 tháng thì POC nằm ở
// một cái kệ lịch sử nào đó và mọi TP đều vô dụng.
//   15m ≈ 2 ngày · 1h ≈ 7 ngày · 4h ≈ 3 tuần · 1D ≈ 3 tháng
const LIMIT: Record<TF, number> = { '15m': 192, '1h': 168, '4h': 126, '1d': 90 };

/** TF lớn hơn liền kề — dùng làm context, KHÔNG dùng để ghi đè bias TF nhỏ. */
const PARENT: Record<TF, TF | null> = { '15m': '1h', '1h': '4h', '4h': '1d', '1d': null };

function hasClosedBar(candles: Candle[], tf: TF): boolean {
  const closed = candles.filter((c) => c.closed);
  if (closed.length === 0) return false;
  // Nến đóng gần nhất phải thuộc chu kỳ vừa xong, không phải nến cũ mốc meo.
  const last = closed[closed.length - 1];
  return Date.now() - (last.t + TF_MS[tf]) < TF_MS[tf] * 2;
}

function sliceFrom(candles: Candle[], fromTs: number): Candle[] {
  return candles.filter((c) => c.t >= fromTs);
}

/**
 * Composite profile từ nến 15m: session (00:00 ICT) · 24h · 3D.
 * Dual read: giá dưới POC 3D nhưng trên POC session = pullback, KHÔNG phải sập.
 */
export function buildComposite(k15: Candle[], last: number, atr15: number): CompositeProfiles {
  const now = Date.now();
  const mk = (from: number): VolumeProfile | null =>
    computeVolumeProfile(sliceFrom(k15, from), { mode: 'close', atr: atr15 });

  const session = mk(ictSessionStart(now));
  const h24 = mk(now - 24 * 3_600_000);
  const d3 = mk(now - 3 * 24 * 3_600_000);

  let dualRead: string | null = null;
  if (session && d3) {
    if (last < d3.poc && last > session.poc) {
      dualRead = 'Giá dưới POC 3D nhưng trên POC session → pullback trong cấu trúc, không phải sập.';
    } else if (last > d3.poc && last < session.poc) {
      dualRead = 'Giá trên POC 3D nhưng dưới POC session → hồi kỹ thuật trong ngày, chưa phải trend mới.';
    } else if (last < d3.poc && last < session.poc) {
      dualRead = 'Giá dưới cả POC 3D và POC session → phe bán đang giữ value, chỉ tìm short ở mép.';
    } else {
      dualRead = 'Giá trên cả POC 3D và POC session → phe mua đang giữ value, chỉ tìm long ở mép.';
    }
  }
  return { session, h24, d3, dualRead };
}

/**
 * SymbolScan với ba trường bản-điện đã được ép kiểu thật.
 * types.ts để `unknown` vì nó không thể import direct.ts (direct.ts import ngược lại
 * types.ts qua decide.ts — vòng tròn). Chỗ khai báo kiểu đúng là ở đây.
 */
export interface SymbolScanLive extends Omit<SymbolScan, 'direction' | 'structure' | 'flow'> {
  direction: Record<TF, DirectionalCall | null>;
  structure: Record<TF, MarketStructure | null>;
  flow: FlowInfo | null;
}

export async function scanSymbol(symbol: string): Promise<SymbolScanLive> {
  const errors: string[] = [];

  const [k15, k1h, k4h, k1d, ticker] = await Promise.all([
    fetchKlines(symbol, '15m', LIMIT['15m']).catch((e) => { errors.push(`klines 15m: ${e.message}`); return [] as Candle[]; }),
    fetchKlines(symbol, '1h', LIMIT['1h']).catch((e) => { errors.push(`klines 1h: ${e.message}`); return [] as Candle[]; }),
    fetchKlines(symbol, '4h', LIMIT['4h']).catch((e) => { errors.push(`klines 4h: ${e.message}`); return [] as Candle[]; }),
    fetchKlines(symbol, '1d', LIMIT['1d']).catch((e) => { errors.push(`klines 1d: ${e.message}`); return [] as Candle[]; }),
    fetchTicker(symbol).catch(() => null),
  ]);

  const byTf: Record<TF, Candle[]> = { '15m': k15, '1h': k1h, '4h': k4h, '1d': k1d };
  const closed15 = k15.filter((c) => c.closed);
  const last = closed15.length ? closed15[closed15.length - 1].c : (ticker?.lastPrice ?? 0);

  // Δ giá 1h để đọc OI (OI ↑/↓ đi cùng giá ↑/↓ mới có nghĩa)
  const c1h = k1h.filter((c) => c.closed);
  const chg1h = c1h.length >= 2
    ? ((c1h[c1h.length - 1].c - c1h[c1h.length - 2].c) / c1h[c1h.length - 2].c) * 100
    : null;

  const [perp, okx] = await Promise.all([
    fetchBinancePerp(symbol),
    fetchOkx(symbol).catch(() => ({
      ok: false, fundingRate: null, nextFundingTime: null, markPrice: null,
      oiUsd: null, oiHistUsd: null, perpVol24hUsd: null,
    })),
  ]);
  const [perpTaker, positioning] = await Promise.all([
    fetchPerpTakerRatio(symbol).catch(() => null),
    fetchPerpPositioning(symbol).catch(() => ({ retailLongPct: null, topLongPct: null })),
  ]);

  const deriv = buildDerivatives(
    perp, okx, chg1h, ticker?.priceChangePercent ?? null, okx.perpVol24hUsd, perpTaker,
  );

  const atr15 = atr(closed15);
  const composite = buildComposite(k15, last, atr15);
  const vp15Full = computeVolumeProfile(closed15, { mode: 'close', atr: atr15 });
  const spotDelta = buildDelta(k15, vp15Full, 'binance-spot');

  // Tính từ TF LỚN xuống nhỏ để mỗi TF có context cha, nhưng bias vẫn tính độc lập.
  const tfs = {} as Record<TF, Recommendation>;
  const direction = {} as Record<TF, DirectionalCall | null>;
  const structure = {} as Record<TF, MarketStructure | null>;
  const ordered: TF[] = ['1d', '4h', '1h', '15m'];
  let flow: FlowInfo | null = null;

  for (const tf of ordered) {
    const candles = byTf[tf];
    const closed = candles.filter((c) => c.closed);
    if (closed.length < 30) {
      tfs[tf] = emptyRec(symbol, tf, last, `thiếu dữ liệu ${tf} (${closed.length} nến đóng)`);
      direction[tf] = null; structure[tf] = null;
      continue;
    }
    const parent = PARENT[tf];
    const parentRec = parent ? tfs[parent] : undefined;
    const parentPa = parent ? analyzePriceAction(byTf[parent]) : null;
    const htf: HTFContext | null = parent && parentRec
      ? {
          bias: parentRec.bias,
          trendUp: parentPa?.trendUp ?? false,
          trendDown: parentPa?.trendDown ?? false,
          rangeHigh: parentPa?.range.high ?? null,
          rangeLow: parentPa?.range.low ?? null,
          tf: parent,
        }
      : null;

    // Dựng đầu vào qua prepareTF — CÙNG một hàm mà backtest dùng.
    const prepared = prepareTF({
      symbol, tf, candles, deriv, htf, hasClosedBar: hasClosedBar(candles, tf),
    });
    if (!prepared) {
      tfs[tf] = emptyRec(symbol, tf, last, `không dựng được volume profile ${tf}`);
      direction[tf] = null; structure[tf] = null;
      continue;
    }

    if (!flow) flow = buildFlow(perpTaker, k15, positioning, deriv.funding);
    const both = decideBoth(prepared, flow);
    tfs[tf] = both.strict;
    structure[tf] = prepared.structure;
    direction[tf] = both.directional;
  }

  const pa15 = analyzePriceAction(k15);

  return {
    symbol,
    ts: Date.now(),
    price: ticker?.lastPrice ?? last,
    change24h: ticker?.priceChangePercent ?? 0,
    quoteVolume24h: ticker?.quoteVolume ?? 0,
    rangePos: pa15.rangePos,
    tfs,
    derivatives: deriv,
    spotTakerDelta: spotDelta,
    direction,
    structure,
    flow,
    composite: {
      sessionPoc: composite.session?.poc ?? null,
      h24Poc: composite.h24?.poc ?? null,
      d3Poc: composite.d3?.poc ?? null,
      dualRead: composite.dualRead,
    },
    errors,
  };
}

function emptyRec(symbol: string, tf: TF, last: number, why: string): Recommendation {
  return {
    symbol, tf, bias: 'WAIT', stage: 'mid-range', entry: null,
    trigger: 'không có — thiếu dữ liệu',
    sl: null, tp1: null, tp2: null, runner: null, rr1: null, rr2: null,
    size: 'Small',
    invalidation: 'không áp dụng',
    reasons: [why, 'Không bịa số khi thiếu dữ liệu.', 'WAIT là kết luận hợp lệ.'],
    confidence: 1,
    confluence: { score: 0, raw: 0, lines: [{ label: why, points: 0 }] },
    warnings: [why],
    counterTrend: false,
    vp: { poc: last, vaLow: last, vaHigh: last, last, binSize: 0.001, hvn: [], lvn: [] },
    rangePos: 50,
    planText: `[${symbol}] [${tf}] [WAIT] score 0/10\n${why}`,
  };
}

export function sourcesInfo() {
  return {
    spot: SOURCES.SPOT,
    perp: venueState.perpAlive === false
      ? `${SOURCES.FAPI} — CHẾT: ${venueState.perpReason}`
      : SOURCES.FAPI,
    okx: SOURCES.OKX,
  };
}

export { TFS };
