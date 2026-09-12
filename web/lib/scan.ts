import { ictSessionStart } from './format';
import { analyzePriceAction, atr } from './priceAction';
import { buildDelta, buildDerivatives } from './derivatives';
import { blindDerivatives } from './backtest';
import { type HTFContext } from './decide';
import { rKyVong, type DirectionalCall } from './direct';
import { apDungH9, evaluate as danhGiaVongDoi, type BarK, type LifecycleInput } from './lifecycle';
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


// ---------------------------------------------------------------------------
// Sự thật quan sát được để chấm vòng đời. Tất cả lấy từ NẾN ĐÃ ĐÓNG + giá live,
// không lấy từ lần quét trước.
// ---------------------------------------------------------------------------

// Volume BASE, luôn luôn. `c.q || c.v` trộn hai đơn vị: cây có quote volume thì
// so bằng USD, cây không có thì so bằng coin — hai cây cạnh nhau không so được
// với nhau, mà H8 và cụm vol đều là phép so volume.
const toBar = (c: Candle): BarK => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, closed: c.closed });

/** Cây có volume lớn nhất trong `n` nến đã đóng gần nhất. */
function cayVolMax(candles: Candle[], n: number): Candle | null {
  const closed = candles.filter((c) => c.closed).slice(-n);
  if (!closed.length) return null;
  return closed.reduce((a, b) => (b.v > a.v ? b : a));
}

/** Cụm vol: 2–3 nến 1H volume lớn nhất ĐÃ ĐÓNG trong 48 giờ gần nhất. */
function cumVol1h(k1h: Candle[]): { low: number; high: number; bars: number[] } | null {
  const closed = k1h.filter((c) => c.closed).slice(-48);
  if (closed.length < 3) return null;
  const top = [...closed].sort((a, b) => b.v - a.v).slice(0, 3);
  return {
    low: Math.min(...top.map((c) => c.l)),
    high: Math.max(...top.map((c) => c.h)),
    bars: top.map((c) => c.t).sort((a, b) => a - b),
  };
}

/**
 * H12 — đã có nến 1H ĐÓNG từ chối mép cụm chưa: giá kéo lại chạm dải cụm rồi
 * đóng hẳn ra ngoài. Một cây đỏ không đủ; phải là kéo lại RỒI đóng qua mép.
 */
function daTuChoiMep1h(k1h: Candle[], cum: { low: number; high: number } | null, side: 'LONG' | 'SHORT'): boolean {
  if (!cum) return false;
  const closed = k1h.filter((c) => c.closed).slice(-6);
  return closed.some((c) => (side === 'SHORT'
    ? c.h >= cum.low && c.c < cum.low
    : c.l <= cum.high && c.c > cum.high));
}

const VE_DOI_HUONG = ['Taker', 'Price Action', 'Delta'];

/** Số vế taker / spot / PA đang NGƯỢC hướng thẻ — bản điện. */
function veNguocHuong(call: DirectionalCall): number {
  return call.evidence.filter((e) =>
    VE_DOI_HUONG.some((t) => e.label.includes(t))
    && e.side !== 'neutral'
    && e.side !== call.side.toLowerCase()).length;
}

/** Cùng câu hỏi, đọc từ dòng chấm điểm của đường strict (điểm âm = chống lại). */
function veNguocHuongStrict(rec: Recommendation): number {
  return rec.confluence.lines.filter((l) =>
    l.points < 0 && VE_DOI_HUONG.some((t) => l.label.includes(t))).length;
}

/**
 * Hình dạng tối thiểu mà vòng đời cần. Cả `DirectionalCall` (bản điện) lẫn
 * `Recommendation` (/strict) đều quy về đây, nên chỉ có MỘT bộ dựng đầu vào và
 * MỘT máy trạng thái. Hai não trên cùng một trang là cách bug ENA quay lại.
 */
interface TheCoMuc {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry: [number, number];
  sl: number;
  tp1: number;
  tp2: number;
  trigger: string;
  triggerLevel: number | null;
  rr: number | null;
  warnings: string[];
  opposingLegs: number;
}

function tuBanDien(c: DirectionalCall): TheCoMuc {
  return {
    symbol: c.symbol, side: c.side, entry: c.entry, sl: c.sl, tp1: c.tp1, tp2: c.tp2,
    trigger: c.trigger, triggerLevel: c.triggerLevel, rr: c.rrBlended,
    warnings: c.warnings, opposingLegs: veNguocHuong(c),
  };
}

/** null khi WAIT hoặc chưa dựng được mức giá — không mức giá thì không có thẻ. */
function tuStrict(r: Recommendation): TheCoMuc | null {
  if (r.bias === 'WAIT' || !r.entry || r.sl == null || r.tp1 == null || r.tp2 == null) return null;
  return {
    symbol: r.symbol, side: r.bias, entry: r.entry, sl: r.sl, tp1: r.tp1, tp2: r.tp2,
    trigger: r.trigger, triggerLevel: r.triggerLevel,
    rr: rKyVong(r.rr1, r.rr2),
    warnings: r.warnings, opposingLegs: veNguocHuongStrict(r),
  };
}

export function dungVongDoi(
  the: TheCoMuc, tf: TF, byTf: Record<TF, Candle[]>,
  lastLive: number, atr1h: number, low24h: number | null, high24h: number | null,
): LifecycleInput {
  const candles = byTf[tf];
  const openK = candles.find((c) => !c.closed) ?? null;
  const closedK = candles.filter((c) => c.closed);
  const cum = cumVol1h(byTf['1h']);
  const cay4h = cayVolMax(byTf['4h'], 42);
  const pa = analyzePriceAction(candles);
  const d1 = byTf['1d'].filter((c) => c.closed).slice(-30);

  return {
    symbol: the.symbol, tf, side: the.side,
    entryLow: the.entry[0], entryHigh: the.entry[1],
    sl: the.sl, tp1: the.tp1, tp2: the.tp2,
    triggerText: the.trigger, triggerLevel: the.triggerLevel,
    last: lastLive, ts: Date.now(),
    openK: openK ? toBar(openK) : null,
    lastClosedK: closedK.length ? toBar(closedK[closedK.length - 1]) : null,
    rr: the.rr,
    atr1h: atr1h > 0 ? atr1h : null,
    low24h, high24h,
    low4hMaxVol: cay4h?.l ?? null,
    high4hMaxVol: cay4h?.h ?? null,
    cum1h: cum,
    rejected1h: daTuChoiMep1h(byTf['1h'], cum, the.side),
    tp1OutsideVa: the.warnings.some((w) => w.includes('TP1') && w.includes('VA')),
    volRatio: pa.volMedian20 > 0 ? pa.lastVol / pa.volMedian20 : null,
    opposingLegs: the.opposingLegs,
    // TP xuyên đáy/đỉnh 30 ngày mà ngoài đó không còn cụm vol nào đỡ.
    tpBreaksUnbackedLevel: d1.length >= 10 && (the.side === 'SHORT'
      ? the.tp2 < Math.min(...d1.map((c) => c.l))
      : the.tp2 > Math.max(...d1.map((c) => c.h))),
    barsSinceIssued: 0,
  };
}

export async function scanSymbol(symbol: string): Promise<SymbolScanLive> {
  const errors: string[] = [];

  const nen = async (tf: TF) => fetchKlines(symbol, tf, LIMIT[tf])
    .catch((e) => { errors.push(`nến ${tf}: ${(e as Error).message}`); return [] as Candle[]; });

  const [k15, k1h, k4h, k1d, ticker] = await Promise.all([
    nen('15m'), nen('1h'), nen('4h'), nen('1d'),
    fetchTicker(symbol).catch((e) => {
      errors.push(`ticker 24h: ${(e as Error).message}`);
      return null;
    }),
  ]);

  const byTf: Record<TF, Candle[]> = { '15m': k15, '1h': k1h, '4h': k4h, '1d': k1d };
  const closed15 = k15.filter((c) => c.closed);
  const last = closed15.length ? closed15[closed15.length - 1].c : (ticker?.lastPrice ?? 0);

  // KHÔNG có nến nào và KHÔNG có ticker = không biết gì về mã này. Trả thẳng một
  // bản ghi rỗng có `price: null` thay vì `price: 0` kèm bốn thẻ WAIT: số 0 hiện
  // lên màn hình trông y như một cái giá, còn WAIT trông y như một kết luận.
  if (!closed15.length && !ticker) {
    return rong(symbol, errors.length ? errors : ['không lấy được dữ liệu nào']);
  }

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

  // ---- VÒNG ĐỜI: tính lại từ đầu mỗi lần quét, từ giá LIVE + nến đã đóng ----
  // Giá LIVE = ticker 24h hiện tại, KHÔNG phải close của nến 15m đã đóng. Thẻ
  // 4H ngày 11/09 sống sót vì `last` là close nến cũ nên không thấy giá đã
  // xuyên SL.
  const lastLive = ticker?.lastPrice ?? last;
  const lo = ticker?.lowPrice ?? null;
  const hi = ticker?.highPrice ?? null;
  const atr1h = atr(k1h.filter((c) => c.closed));
  type Cham = { side: 'LONG' | 'SHORT'; v: NonNullable<DirectionalCall['lifecycle']> };

  // Bản điện và /strict là hai bộ THẺ khác nhau nhưng đi qua CÙNG evaluate().
  // H9 áp trong từng bộ — ghép chéo hai đường sẽ làm một não khoá não kia.
  const vBanDien: Cham[] = [];
  const vStrict: Cham[] = [];
  for (const tf of TFS) {
    const call = direction[tf];
    if (call) {
      const v = danhGiaVongDoi(dungVongDoi(tuBanDien(call), tf, byTf, lastLive, atr1h, lo, hi));
      call.lifecycle = v;
      vBanDien.push({ side: call.side, v });
    }
    const rec = tfs[tf];
    const the = rec ? tuStrict(rec) : null;
    if (rec && the) {
      const v = danhGiaVongDoi(dungVongDoi(the, tf, byTf, lastLive, atr1h, lo, hi));
      rec.lifecycle = v;
      vStrict.push({ side: the.side, v });
    }
  }
  apDungH9(vBanDien);
  apDungH9(vStrict);

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

/** Không có dữ liệu thì nói KHÔNG CÓ, đừng dựng một bản phân tích rỗng. */
function rong(symbol: string, errors: string[]): SymbolScanLive {
  const tfs = {} as Record<TF, Recommendation>;
  const direction = {} as Record<TF, DirectionalCall | null>;
  const structure = {} as Record<TF, MarketStructure | null>;
  for (const tf of TFS) {
    tfs[tf] = emptyRec(symbol, tf, 0, 'không có dữ liệu');
    direction[tf] = null;
    structure[tf] = null;
  }
  return {
    symbol, ts: Date.now(),
    price: null, change24h: null, quoteVolume24h: null, rangePos: null,
    tfs, derivatives: blindDerivatives(), spotTakerDelta: blindDerivatives().perpTaker,
    direction, structure, flow: null,
    composite: { sessionPoc: null, h24Poc: null, d3Poc: null, dualRead: null },
    errors,
  };
}

function emptyRec(symbol: string, tf: TF, last: number, why: string): Recommendation {
  return {
    symbol, tf, bias: 'WAIT', stage: 'mid-range', entry: null,
    trigger: 'không có — thiếu dữ liệu', triggerLevel: null, lifecycle: null,
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
