import type { Candle, DataQuality, FundingInfo } from './types';
import type { PerpPositioning } from './sources';

// ============================================================
// Dòng tiền: ai đang ĐÁNH (taker buy vs sell), ai đang ĐỨNG (long/short
// positioning), và ai đang TRẢ TIỀN cho ai (funding).
//
// Luật giữ nguyên từ đầu: KHÔNG gộp spot với perp thành một con số. Hai chợ
// khác nhau thì báo cáo tách ra, và chỉ khi cả hai cùng nghiêng một phía mới
// gọi là đồng thuận.
// ============================================================

export interface FlowSide {
  venue: 'binance-perp' | 'binance-spot';
  quality: DataQuality;
  buy: number;
  sell: number;
  /** 0–100. >50 = phe mua chủ động nhiều hơn. */
  buyPct: number;
  note: string;
}

export type FundingPayer = 'long-pays-short' | 'short-pays-long' | 'flat' | 'na';

export interface FundingFlow {
  payer: FundingPayer;
  rate: number | null;
  /** Quy ra %/năm để thấy độ đắt thật của việc gồng vị thế. */
  annualPct: number | null;
  text: string;
}

export interface FlowInfo {
  perpTaker: FlowSide | null;
  spotTaker: FlowSide | null;
  positioning: PerpPositioning;
  funding: FundingFlow;
  /** Kết luận gộp: 'buy' | 'sell' | 'balanced'. */
  lean: 'buy' | 'sell' | 'balanced';
  /** 0–100, độ lệch so với cân bằng. */
  leanStrength: number;
  /** true khi perp và spot cùng nghiêng một phía. */
  agree: boolean;
  note: string;
}

const BALANCED_BAND = 3;   // buyPct trong 50±3 coi là cân bằng

function side(
  venue: FlowSide['venue'],
  buy: number,
  sell: number,
  note: string,
): FlowSide | null {
  const total = buy + sell;
  if (!isFinite(total) || total <= 0) return null;
  return { venue, quality: 'REAL', buy, sell, buyPct: (buy / total) * 100, note };
}

/** Taker perp từ Binance futures/data/takerlongshortRatio. */
export function perpTakerFlow(rows: { buy: number; sell: number }[] | null, bars = 8): FlowSide | null {
  if (!rows || rows.length === 0) return null;
  const tail = rows.slice(-bars);
  const buy = tail.reduce((s, r) => s + r.buy, 0);
  const sell = tail.reduce((s, r) => s + r.sell, 0);
  return side('binance-perp', buy, sell, `Taker perp, ${tail.length} cây gần nhất.`);
}

/** Taker spot từ field taker-buy-base của kline. Số thật, nhưng là chợ SPOT. */
export function spotTakerFlow(candles: Candle[], bars = 8): FlowSide | null {
  const closed = candles.filter((c) => c.closed && c.takerBuyBase != null).slice(-bars);
  if (closed.length === 0) return null;
  const buy = closed.reduce((s, c) => s + (c.takerBuyBase as number), 0);
  const sell = closed.reduce((s, c) => s + (c.v - (c.takerBuyBase as number)), 0);
  return side('binance-spot', buy, sell, `Taker spot, ${closed.length} cây gần nhất.`);
}

/**
 * Funding dương = phe LONG trả phe SHORT (đám đông đang đứng long và phải nuôi
 * vị thế). Âm thì ngược lại. Đây là dòng tiền thật chảy giữa hai phe mỗi 8 giờ.
 */
export function fundingFlow(f: FundingInfo): FundingFlow {
  if (f.quality !== 'REAL' || f.rate == null) {
    return { payer: 'na', rate: null, annualPct: null, text: 'N/A — không dùng làm lý do.' };
  }
  const annualPct = f.rate * 3 * 365 * 100;   // 3 lần/ngày
  if (f.flat) {
    return {
      payer: 'flat', rate: f.rate, annualPct,
      text: `Phẳng (${(f.rate * 100).toFixed(4)}%/8h ≈ ${annualPct.toFixed(1)}%/năm) — không bên nào bị ép.`,
    };
  }
  const payer: FundingPayer = f.rate > 0 ? 'long-pays-short' : 'short-pays-long';
  return {
    payer, rate: f.rate, annualPct,
    text: payer === 'long-pays-short'
      ? `LONG đang trả SHORT ${(f.rate * 100).toFixed(4)}%/8h (≈ ${annualPct.toFixed(1)}%/năm) — giữ long đang tốn tiền.`
      : `SHORT đang trả LONG ${(Math.abs(f.rate) * 100).toFixed(4)}%/8h (≈ ${Math.abs(annualPct).toFixed(1)}%/năm) — giữ short đang tốn tiền.`,
  };
}

export function buildFlow(
  perpRows: { buy: number; sell: number }[] | null,
  candles: Candle[],
  positioning: PerpPositioning,
  funding: FundingInfo,
): FlowInfo {
  const perpTaker = perpTakerFlow(perpRows);
  const spotTaker = spotTakerFlow(candles);
  const ff = fundingFlow(funding);

  // Perp nặng hơn spot khi đọc áp lực phái sinh, nhưng chỉ khi có thật.
  const parts: { pct: number; w: number }[] = [];
  if (perpTaker) parts.push({ pct: perpTaker.buyPct, w: 0.65 });
  if (spotTaker) parts.push({ pct: spotTaker.buyPct, w: 0.35 });

  let combined = 50;
  if (parts.length) {
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    combined = parts.reduce((s, p) => s + p.pct * p.w, 0) / wsum;
  }

  const agree = !!(perpTaker && spotTaker &&
    ((perpTaker.buyPct > 50 && spotTaker.buyPct > 50) ||
     (perpTaker.buyPct < 50 && spotTaker.buyPct < 50)));

  const lean: FlowInfo['lean'] =
    combined > 50 + BALANCED_BAND ? 'buy'
    : combined < 50 - BALANCED_BAND ? 'sell'
    : 'balanced';

  const bits: string[] = [];
  if (perpTaker) bits.push(`perp ${perpTaker.buyPct.toFixed(1)}% mua`);
  else bits.push('perp N/A');
  if (spotTaker) bits.push(`spot ${spotTaker.buyPct.toFixed(1)}% mua`);
  else bits.push('spot N/A');
  if (positioning.retailLongPct != null) bits.push(`tài khoản lẻ ${positioning.retailLongPct.toFixed(1)}% long`);
  if (positioning.topLongPct != null) bits.push(`nhóm lớn ${positioning.topLongPct.toFixed(1)}% long`);

  return {
    perpTaker, spotTaker, positioning, funding: ff,
    lean,
    leanStrength: Math.min(100, Math.abs(combined - 50) * 4),
    agree,
    note: bits.join(' · ') + (agree ? ' · perp và spot ĐỒNG THUẬN' : ''),
  };
}

/** Chênh lệch giữa bán lẻ và nhóm lớn — chỗ hai bên ngược nhau là chỗ đáng đọc. */
export function positioningSplit(p: PerpPositioning): string | null {
  if (p.retailLongPct == null || p.topLongPct == null) return null;
  const d = p.topLongPct - p.retailLongPct;
  if (Math.abs(d) < 5) return null;
  return d > 0
    ? `Nhóm lớn long nhiều hơn bán lẻ ${d.toFixed(1)} điểm — tiền lớn đứng phía mua.`
    : `Bán lẻ long nhiều hơn nhóm lớn ${Math.abs(d).toFixed(1)} điểm — đám đông đang đứng long một mình.`;
}
