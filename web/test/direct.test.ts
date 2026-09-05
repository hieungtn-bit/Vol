import { describe, expect, it } from 'vitest';
import { analyzeStructure } from '@/lib/structure';
import { buildFlow, fundingFlow, perpTakerFlow, positioningSplit, spotTakerFlow } from '@/lib/flow';
import { decideDirection } from '@/lib/direct';
import { analyzePriceAction } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import { flat, mkCandles, noDerivatives, type Spec } from './fixtures';
import type { FundingInfo } from '@/lib/types';

const noPos = { retailLongPct: null, topLongPct: null };

function bar(from: number, to: number, opts: { spikeUp?: number; spikeDn?: number; v?: number; tb?: number } = {}): Spec {
  const hi = Math.max(from, to) + (opts.spikeUp ?? 0.02);
  const lo = Math.min(from, to) - (opts.spikeDn ?? 0.02);
  return { o: from, h: hi, l: lo, c: to, v: opts.v ?? 100, tb: opts.tb ?? 55 };
}

/**
 * Zigzag thật: mỗi chân đẩy 5 nến rồi hồi 4 nến.
 *
 * Hai chi tiết bắt buộc, thiếu là fractal không hình thành:
 *  - nhịp hồi phải đủ dài (≥ 3 nến) cho cửa sổ 3-trái/3-phải;
 *  - nến QUAY ĐẦU phải có wick nhô hẳn ra. Nếu không, nến hồi đầu tiên mở đúng
 *    tại đỉnh nên high bằng hệt nến đỉnh, và findSwings đòi cực trị CHẶT nên
 *    không nhận. (Trong xu hướng trơn tuột thì đúng là không có swing hoàn chỉnh.)
 */
function trend(up: boolean, legs = 4): Spec[] {
  const out: Spec[] = [];
  const dir = up ? 1 : -1;
  let p = 100;
  for (let L = 0; L < legs; L++) {
    for (let i = 0; i < 5; i++) {
      const n = p + dir * 1.2;
      const turn = i === 4;
      out.push(bar(p, n, turn ? (up ? { spikeUp: 0.6 } : { spikeDn: 0.6 }) : {}));
      p = n;
    }
    for (let i = 0; i < 4; i++) {
      const n = p - dir * 0.6;
      const turn = i === 3;
      out.push(bar(p, n, { v: 80, tb: 40, ...(turn ? (up ? { spikeDn: 0.6 } : { spikeUp: 0.6 }) : {}) }));
      p = n;
    }
  }
  return out;
}

describe('cấu trúc HH/HL/LH/LL', () => {
  it('chuỗi tăng → uptrend, bias dương, đỉnh gần nhất HH', () => {
    const st = analyzeStructure(mkCandles(trend(true)));
    expect(st.state).toBe('uptrend');
    expect(st.bias).toBeGreaterThan(0);
    expect(st.lastHigh?.label).toBe('HH');
    expect(st.lastLow?.label).toBe('HL');
  });

  it('chuỗi giảm → downtrend, bias âm', () => {
    const st = analyzeStructure(mkCandles(trend(false)));
    expect(st.state).toBe('downtrend');
    expect(st.bias).toBeLessThan(0);
    expect(st.lastHigh?.label).toBe('LH');
    expect(st.lastLow?.label).toBe('LL');
  });

  it('mức bẻ gãy cấu trúc là đáy HL gần nhất khi đang tăng', () => {
    const st = analyzeStructure(mkCandles(trend(true)));
    expect(st.breakLevel).toBe(st.lastLow?.price);
  });

  it('dữ liệu quá ngắn → unclear, không bịa cấu trúc', () => {
    const st = analyzeStructure(mkCandles(flat(6, 100, 100)));
    expect(st.state).toBe('unclear');
    expect(st.bias).toBe(0);
  });
});

describe('dòng tiền Buy/Sell', () => {
  it('taker perp nghiêng mua → buyPct > 50', () => {
    const f = perpTakerFlow([{ buy: 70, sell: 30 }, { buy: 60, sell: 40 }]);
    expect(f!.buyPct).toBeCloseTo(65, 5);
    expect(f!.venue).toBe('binance-perp');
  });

  it('taker spot lấy từ field taker-buy của kline, gắn nhãn chợ spot', () => {
    const cs = mkCandles(flat(10, 100, 100).map((s) => ({ ...s, tb: 70 })));
    const f = spotTakerFlow(cs);
    expect(f!.buyPct).toBeCloseTo(70, 5);
    expect(f!.venue).toBe('binance-spot');
  });

  it('không có taker → null, KHÔNG lấy chợ kia lấp vào', () => {
    expect(perpTakerFlow(null)).toBeNull();
    expect(spotTakerFlow(mkCandles(flat(10, 100, 100)))).toBeNull();
  });

  it('perp và spot cùng nghiêng một phía mới gọi là đồng thuận', () => {
    const cs = mkCandles(flat(10, 100, 100).map((s) => ({ ...s, tb: 70 })));
    const agree = buildFlow([{ buy: 70, sell: 30 }], cs, noPos, noDerivatives().funding);
    expect(agree.agree).toBe(true);
    expect(agree.lean).toBe('buy');

    const disagree = buildFlow([{ buy: 20, sell: 80 }], cs, noPos, noDerivatives().funding);
    expect(disagree.agree).toBe(false);
  });
});

describe('funding — ai trả ai', () => {
  const mk = (rate: number, flatFr: boolean, extreme = false): FundingInfo => ({
    quality: 'REAL', venue: 'binance-perp', rate, nextFundingTime: null,
    markPrice: 100, flat: flatFr, extreme, note: '',
  });

  it('funding dương → LONG trả SHORT', () => {
    const f = fundingFlow(mk(0.0004, false));
    expect(f.payer).toBe('long-pays-short');
    expect(f.text).toContain('LONG đang trả SHORT');
  });

  it('funding âm → SHORT trả LONG', () => {
    const f = fundingFlow(mk(-0.0004, false));
    expect(f.payer).toBe('short-pays-long');
    expect(f.text).toContain('SHORT đang trả LONG');
  });

  it('quy đổi %/năm đúng nhịp 3 lần mỗi ngày', () => {
    const f = fundingFlow(mk(0.0001, false));
    expect(f.annualPct).toBeCloseTo(0.0001 * 3 * 365 * 100, 6);
  });

  it('phẳng → không bên nào bị ép, và N/A thì nói N/A', () => {
    expect(fundingFlow(mk(0.00005, true)).payer).toBe('flat');
    expect(fundingFlow(noDerivatives().funding).payer).toBe('na');
  });
});

describe('engine luôn ra hướng', () => {
  function call(specs: Spec[], perpRows: { buy: number; sell: number }[] | null) {
    const candles = mkCandles(specs);
    const closed = candles.filter((c) => c.closed);
    const vp = computeVolumeProfile(closed, { binSize: 0.2 })!;
    const pa = analyzePriceAction(candles);
    const st = analyzeStructure(candles);
    const deriv = noDerivatives();
    const flow = buildFlow(perpRows, candles, noPos, deriv.funding);
    return decideDirection(
      {
        symbol: 'TESTUSDT', tf: '15m', candles, vp, pa,
        delta: buildDelta(candles, vp, 'binance-spot'),
        deriv, htf: null, hasClosedBar: true,
        last: closed[closed.length - 1].c,
      },
      st, flow,
    );
  }

  it('KHÔNG BAO GIỜ trả WAIT — luôn là LONG hoặc SHORT', () => {
    for (const specs of [trend(true), trend(false), flat(60, 100, 100)]) {
      const c = call(specs, null);
      expect(['LONG', 'SHORT']).toContain(c.side);
    }
  });

  it('cấu trúc tăng + taker mua áp đảo → LONG', () => {
    const c = call(trend(true), [{ buy: 85, sell: 15 }, { buy: 80, sell: 20 }]);
    expect(c.side).toBe('LONG');
    expect(c.longScore).toBeGreaterThan(c.shortScore);
  });

  it('cấu trúc giảm + taker bán áp đảo → SHORT', () => {
    const c = call(trend(false), [{ buy: 15, sell: 85 }, { buy: 20, sell: 80 }]);
    expect(c.side).toBe('SHORT');
    expect(c.shortScore).toBeGreaterThan(c.longScore);
  });

  it('longScore + shortScore luôn bằng 100', () => {
    const c = call(trend(true), [{ buy: 60, sell: 40 }]);
    expect(c.longScore + c.shortScore).toBe(100);
  });

  it('bằng chứng cân nhau → hạng C và cảnh báo nói thẳng là kèo yếu', () => {
    const c = call(flat(60, 100, 100), [{ buy: 50, sell: 50 }]);
    if (Math.abs(c.net) < 15) {
      expect(c.conviction).toBe('C');
      expect(c.warnings.join(' ')).toContain('hai phía gần cân nhau');
      expect(c.size).toBe('Small');
    }
  });

  it('mức giá xếp đúng hình theo hướng đã chọn', () => {
    for (const specs of [trend(true), trend(false)]) {
      const c = call(specs, null);
      if (c.side === 'LONG') {
        expect(c.sl).toBeLessThan(c.entry[0]);
        expect(c.tp1).toBeGreaterThan(c.entry[1]);
        expect(c.tp2).toBeGreaterThan(c.tp1);
      } else {
        expect(c.sl).toBeGreaterThan(c.entry[1]);
        expect(c.tp1).toBeLessThan(c.entry[0]);
        expect(c.tp2).toBeLessThan(c.tp1);
      }
    }
  });

  it('long ngược cấu trúc giảm phải bị gắn cảnh báo counter-trend', () => {
    const c = call(trend(false), [{ buy: 95, sell: 5 }, { buy: 95, sell: 5 }]);
    if (c.side === 'LONG') {
      expect(c.warnings.join(' ')).toContain('counter-trend');
    }
  });

  it('plan text có đủ dòng bắt buộc kể cả phần ai-trả-ai', () => {
    const c = call(trend(true), [{ buy: 70, sell: 30 }]);
    for (const k of ['Entry:', 'SL:', 'TP1:', 'TP2:', 'Hủy:', 'Cấu trúc:', 'Dòng tiền:', 'Funding:', 'Bằng chứng:']) {
      expect(c.planText).toContain(k);
    }
  });
});

describe('volume không được chấm hướng hai lần', () => {
  function build(vLast: number) {
    const specs: Spec[] = [];
    for (let i = 0; i < 40; i++) specs.push(bar(100, 100.2, { v: 100 }));
    // cây cuối đỏ, chỉ khác nhau ở volume
    specs.push(bar(100.2, 99.4, { v: vLast }));
    return specs;
  }
  function evOf(specs: Spec[]) {
    const candles = mkCandles(specs);
    const closed = candles.filter((c) => c.closed);
    const vp = computeVolumeProfile(closed, { binSize: 0.2 })!;
    const pa = analyzePriceAction(candles);
    const st = analyzeStructure(candles);
    const deriv = noDerivatives();
    const flow = buildFlow(null, candles, noPos, deriv.funding);
    const c = decideDirection(
      { symbol: 'T', tf: '15m', candles, vp, pa, delta: buildDelta(candles, vp, 'binance-spot'),
        deriv, htf: null, hasClosedBar: true, last: closed[closed.length - 1].c },
      st, flow,
    );
    return {
      pa: c.evidence.find((e) => e.label === 'Price Action')!,
      vol: c.evidence.find((e) => e.label.startsWith('Volume'))!,
    };
  }

  it('Volume có điểm riêng bằng 0 — nó chỉ là hệ số cho PA', () => {
    for (const v of [20, 100, 400]) expect(evOf(build(v)).vol.points).toBe(0);
  });

  it('volume lớn làm PA nặng hơn, volume teo làm PA nhẹ đi', () => {
    const weak = evOf(build(20));    // 0.2× median → teo
    const norm = evOf(build(100));   // 1× median
    const big = evOf(build(400));    // 4× median → xác nhận mạnh
    // cây cuối đỏ nên PA âm; "nặng hơn" nghĩa là âm sâu hơn
    expect(Math.abs(big.pa.points)).toBeGreaterThan(Math.abs(norm.pa.points));
    expect(Math.abs(weak.pa.points)).toBeLessThan(Math.abs(norm.pa.points));
    expect(big.vol.detail).toContain('×1.4');
    expect(weak.vol.detail).toContain('×0.5');
  });
});

describe('bán lẻ vs nhóm lớn', () => {
  it('chênh nhỏ hơn 5 điểm → không nói gì (tránh nhiễu)', () => {
    expect(positioningSplit({ retailLongPct: 60, topLongPct: 62 })).toBeNull();
  });

  it('nhóm lớn long nhiều hơn → nói tiền lớn đứng phía mua', () => {
    const s = positioningSplit({ retailLongPct: 50, topLongPct: 68 })!;
    expect(s).toContain('Nhóm lớn long nhiều hơn');
    expect(s).toContain('18.0');
  });

  it('bán lẻ long nhiều hơn → nói đám đông đang đứng long một mình', () => {
    const s = positioningSplit({ retailLongPct: 72, topLongPct: 60 })!;
    expect(s).toContain('đám đông đang đứng long một mình');
  });

  it('thiếu một vế → null, không suy diễn', () => {
    expect(positioningSplit({ retailLongPct: 60, topLongPct: null })).toBeNull();
    expect(positioningSplit({ retailLongPct: null, topLongPct: 60 })).toBeNull();
  });
});
