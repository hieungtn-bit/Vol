import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRICT, classifyStage, decideBias, noEdgeReason, scoreConfluence,
  type DecideInput,
} from '@/lib/decide';
import { analyzePriceAction } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import { recToCall } from '@/lib/backtestStrict';
import type { Candle } from '@/lib/types';

/** Nến quanh `base`, rồi `tail` nến cuối rời đi `drift` để giá ra ngoài value. */
function series(base: number, n: number, drift = 0, tail = 0): Candle[] {
  const out: Candle[] = [];
  const start = Date.now() - (n + 2) * 3_600_000;
  for (let i = 0; i < n; i++) {
    const away = i >= n - tail ? drift * ((i - (n - tail) + 1) / Math.max(1, tail)) : 0;
    const p = base + Math.sin(i / 6) * (base * 0.004) + away;
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

describe('nhãn phải nói đúng cái nào là cái nào', () => {
  it('giá RỜI HẲN khỏi value không được hiện là "đứng GIỮA value"', () => {
    // Đây là lỗi thật đã thấy trên production: BNB 15m giá 721.49, VA 744–759.5,
    // tức dưới VA 1.45 lần bề rộng VA, mà màn hình ghi "đứng GIỮA value area" —
    // ngay cạnh câu "giá đã rời hẳn xuống dưới value".
    const i = inp(series(100, 160, -14, 30));
    const pos = (i.last - i.vp.va70.low) / (i.vp.va70.high - i.vp.va70.low);
    expect(pos).toBeLessThan(0);                       // đúng là ở ngoài
    expect(noEdgeReason(i.vp, i.pa, i.last)).toBe('roi-khoi-value');

    const rec = decideBias(i);
    const nhan = rec.confluence.lines.map((l) => l.label).join(' ');
    if (rec.confluence.lines.length) {
      expect(nhan).not.toMatch(/đứng GIỮA value/);
    }
  });

  it('giá ĐỨNG GIỮA value thì vẫn nói đúng là đứng giữa', () => {
    const i = inp(series(100, 160));
    if (noEdgeReason(i.vp, i.pa, i.last) === 'giua-value') {
      const rec = decideBias(i);
      expect(rec.confluence.lines.map((l) => l.label).join(' ')).toMatch(/đứng GIỮA value/);
    }
  });

  it('noEdgeReason phân biệt đúng ba trường hợp', () => {
    const giua = inp(series(100, 160));
    const ngoai = inp(series(100, 160, -14, 30));
    expect(noEdgeReason(ngoai.vp, ngoai.pa, ngoai.last)).toBe('roi-khoi-value');
    // ở giữa hoặc ở mép — cả hai đều KHÔNG phải 'roi-khoi-value'
    expect(noEdgeReason(giua.vp, giua.pa, giua.last)).not.toBe('roi-khoi-value');
  });
});

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
    // bench/duong-strict.txt: bỏ phạt cho 181 tín hiệu thay vì 60, avgR −0.07 so
    // với −0.14, ngoài mẫu −0.02 so với −0.13, sai số ±0.088 so với ±0.223.
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
    entry: [99, 100] as [number, number], trigger: '', sl: 98, tp1: 102, tp2: 106,
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
