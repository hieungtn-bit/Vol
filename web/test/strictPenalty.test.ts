import { describe, expect, it } from 'vitest';
import { DEFAULT_STRICT, decideBias, scoreConfluence, type DecideInput } from '@/lib/decide';
import { analyzePriceAction } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import { recToCall } from '@/lib/backtestStrict';
import type { Candle } from '@/lib/types';

function series(base: number, n: number): Candle[] {
  const out: Candle[] = [];
  const start = Date.now() - (n + 2) * 3_600_000;
  for (let i = 0; i < n; i++) {
    const p = base + Math.sin(i / 6) * (base * 0.004);
    out.push({
      t: start + i * 3_600_000, o: p, h: p * 1.002, l: p * 0.998, c: p,
      v: 100, q: 100 * p, takerBuyBase: 50, closed: true,
    });
  }
  return out;
}

function inp(candles: Candle[]): DecideInput {
  const closed = candles.filter((c) => c.closed);
  const vp = computeVolumeProfile(closed, { mode: 'close' })!;
  return {
    symbol: 'T', tf: '1h', candles, vp,
    pa: analyzePriceAction(candles),
    delta: buildDelta(candles, vp, 'binance-spot'),
    deriv: { funding: {} as never, oi: {} as never, perpTaker: {} as never },
    htf: null, hasClosedBar: true, last: closed[closed.length - 1].c,
  };
}

describe('phạt RR TP1 — vế đã bỏ ở decideDirection nhưng sót lại ở strict', () => {
  const i = inp(series(100, 160));
  const lv = { entry: [99, 100] as [number, number], sl: 98, tp1: 100.9, tp2: 104, runner: null, tp1InVA: true, crossings: 0 };

  it('rr1 = 0.9 < 1.2: có cấu hình thì trừ 2, bỏ cấu hình thì không', () => {
    const co = scoreConfluence(i, 'LONG', 'edge-hold', lv, 0.9, { rr1Penalty: true });
    const bo = scoreConfluence(i, 'LONG', 'edge-hold', lv, 0.9, { rr1Penalty: false });
    expect(co.lines.some((l) => l.label.startsWith('RR TP1'))).toBe(true);
    expect(bo.lines.some((l) => l.label.startsWith('RR TP1'))).toBe(false);
    expect(bo.raw - co.raw).toBeCloseTo(2, 6);
  });

  it('rr1 ≥ 1.2 thì hai cấu hình giống hệt nhau', () => {
    const co = scoreConfluence(i, 'LONG', 'edge-hold', lv, 1.5, { rr1Penalty: true });
    const bo = scoreConfluence(i, 'LONG', 'edge-hold', lv, 1.5, { rr1Penalty: false });
    expect(co.raw).toBe(bo.raw);
  });

  it('mặc định đã BỎ phạt — theo số đo, không theo cảm tính', () => {
    // Đo bằng scripts/strict.ts ngay trên nhánh này: bỏ phạt cho 179 tín hiệu
    // thay vì 60, avgR −0.10 so với −0.20, ngoài mẫu −0.05 so với −0.13, sai số
    // ±0.088 so với ±0.222.
    // Cả hai vẫn PF < 1 — bỏ phạt làm LỖ ÍT HƠN, không làm có lãi.
    expect(DEFAULT_STRICT.rr1Penalty).toBe(false);
  });

  it('không còn câu "lỗ kỳ vọng" — RR TP1 < 1 không phải kỳ vọng âm', () => {
    // TP1 theo thiết kế là bậc GẦN NHẤT, nên rr1 < 1 là bình thường. Gọi nó là
    // "lỗ kỳ vọng" là cùng loại nhãn sai với "R kỳ vọng" đã sửa ở direct.ts.
    const rec = decideBias(i);
    expect(rec.warnings.join(' ')).not.toMatch(/lỗ kỳ vọng/);
  });
});

describe('backtest strict dùng CHUNG bộ mô phỏng với đường kia', () => {
  const rec = (over: Partial<import('@/lib/types').Recommendation> = {}) => ({
    symbol: 'T', tf: '1h' as const, bias: 'LONG' as const, stage: 'edge-hold' as const,
    entry: [99, 100] as [number, number], trigger: '', triggerLevel: null, lifecycle: null,
    sl: 98, tp1: 102, tp2: 106,
    runner: null, rr1: 2, rr2: 4, size: 'Normal' as const, invalidation: '',
    reasons: [], confidence: 7,
    confluence: { score: 7, raw: 7, lines: [{ label: 'x', points: 7 }] },
    warnings: [], counterTrend: false,
    vp: { poc: 100, vaLow: 99, vaHigh: 101, last: 100, binSize: 0.1, hvn: [], lvn: [] },
    rangePos: 50, planText: '', ...over,
  });

  it('WAIT không thành lệnh', () => {
    expect(recToCall(rec({ bias: 'WAIT' }))).toBeNull();
  });

  it('thiếu mức giá thì không thành lệnh, không bịa số', () => {
    expect(recToCall(rec({ entry: null }))).toBeNull();
    expect(recToCall(rec({ sl: null }))).toBeNull();
    expect(recToCall(rec({ tp1: null }))).toBeNull();
  });

  it('LONG đủ mức giá thì chuyển đúng bốn mốc', () => {
    const c = recToCall(rec())!;
    expect(c.side).toBe('LONG');
    expect(c.entry).toEqual([99, 100]);
    expect(c.sl).toBe(98);
    expect(c.tp1).toBe(102);
    expect(c.tp2).toBe(106);
    // Ra được LONG/SHORT ở đường strict nghĩa là ĐÃ qua cửa của chính nó —
    // không chồng thêm cửa thứ hai.
    expect(c.tradeable).toBe(true);
  });
});
