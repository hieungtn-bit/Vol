import { describe, expect, it } from 'vitest';
import { classifyStage, decideBias, scoreConfluence, type DecideInput } from '@/lib/decide';
import { analyzePriceAction, atr } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import { mkCandles, noDerivatives, type Spec } from './fixtures';

const BASE = 100;

/** Nền value quanh 100 — 40 nến, tạo POC + VA rõ ràng. */
function valueBase(): Spec[] {
  return Array.from({ length: 40 }, (_, i) => ({
    o: BASE + (i % 2 ? 0.2 : -0.2),
    h: BASE + 0.6,
    l: BASE - 0.6,
    c: BASE + (i % 2 ? -0.2 : 0.2),
    v: 100,
    tb: 50,
  }));
}

function build(specs: Spec[], tf: DecideInput['tf'] = '15m'): DecideInput {
  const candles = mkCandles(specs);
  const closed = candles.filter((c) => c.closed);
  const a = atr(closed);
  const vp = computeVolumeProfile(closed, { binSize: 0.1 })!;
  const pa = analyzePriceAction(candles);
  return {
    symbol: 'TESTUSDT', tf, candles, vp, pa,
    delta: buildDelta(candles, vp, 'binance-spot'),
    deriv: noDerivatives(),
    htf: null,
    hasClosedBar: true,
    last: closed[closed.length - 1].c,
  };
}

describe('fail-high: wick trên VAH + close trong VA', () => {
  const specs: Spec[] = [
    ...valueBase(),
    // đẩy lên test mép trên rồi bị đánh xuống
    { o: 100.4, h: 101.2, l: 100.3, c: 101.0, v: 160, tb: 110 },
    { o: 101.0, h: 103.5, l: 100.8, c: 100.9, v: 400, tb: 120 },   // wick 103.5, close lại trong VA
    { o: 100.9, h: 101.1, l: 100.2, c: 100.4, v: 300, tb: 90 },    // nến đỏ đóng xác nhận
  ];
  const inp = build(specs);

  it('phân loại là edge-fail chứ không phải breakout', () => {
    expect(classifyStage(inp.vp, inp.pa, inp.last)).toBe('edge-fail');
  });

  it('nhận diện wick ra ngoài range rồi đóng trong = grab, không phải break', () => {
    const grabInp = build([...valueBase(), { o: 100.4, h: 103.5, l: 100.3, c: 100.5, v: 400, tb: 120 }]);
    expect(grabInp.pa.grab).toBe('up');
    expect(grabInp.pa.acceptedOutside).toBeNull();
  });

  it('ra SHORT chứ tuyệt đối không phải LONG', () => {
    const rec = decideBias(inp);
    expect(rec.bias).not.toBe('LONG');
    // hướng ứng viên là SHORT: mọi mức phải xếp theo hình short
    expect(rec.sl!).toBeGreaterThan(rec.entry![1]);
    expect(rec.tp1!).toBeLessThan(rec.entry![0]);
    expect(rec.tp2!).toBeLessThanOrEqual(rec.tp1!);
  });

  it('TP1 nằm trong value area (luật cứng)', () => {
    const rec = decideBias(inp);
    expect(rec.tp1!).toBeGreaterThanOrEqual(inp.vp.va70.low);
    expect(rec.tp1!).toBeLessThanOrEqual(inp.vp.va70.high);
  });

  it('SL nằm ngoài cụm wick phía trên, không nằm giữa nhiễu', () => {
    const rec = decideBias(inp);
    const maxHigh = Math.max(...inp.candles.slice(-3).map((c) => c.h));
    expect(rec.sl!).toBeGreaterThanOrEqual(Math.min(maxHigh, rec.entry![1]));
  });
});

describe('mid-VA', () => {
  // Value rộng 98–102, dày nhất ở 100, và cây cuối đóng đúng giữa value.
  const wide: Spec[] = [];
  for (let i = 0; i < 60; i++) {
    const offs = [-2, -1, -0.5, 0, 0, 0, 0, 0.5, 1, 2][i % 10];
    wide.push({ o: BASE + offs, h: BASE + offs + 0.3, l: BASE + offs - 0.3, c: BASE + offs, v: 100, tb: 50 });
  }
  wide.push({ o: BASE - 0.1, h: BASE + 0.2, l: BASE - 0.2, c: BASE, v: 90, tb: 45 });
  const inp = build(wide);

  it('giá đứng giữa VA → stage mid-range', () => {
    expect(classifyStage(inp.vp, inp.pa, inp.last)).toBe('mid-range');
  });

  it('→ WAIT, không có entry, và có dòng trừ điểm "giữa value"', () => {
    const rec = decideBias(inp);
    expect(rec.bias).toBe('WAIT');
    expect(rec.entry).toBeNull();
    expect(rec.confluence.score).toBeLessThan(7);
    expect(rec.reasons.length).toBeGreaterThanOrEqual(3);
    expect(rec.confluence.lines.some((l) => l.points < 0)).toBe(true);
  });
});

describe('thiếu funding', () => {
  const specs: Spec[] = [
    ...valueBase(),
    { o: 100.4, h: 101.2, l: 100.3, c: 101.0, v: 160, tb: 110 },
    { o: 101.0, h: 103.5, l: 100.8, c: 100.9, v: 400, tb: 120 },
    { o: 100.9, h: 101.1, l: 100.2, c: 100.4, v: 300, tb: 90 },
  ];
  const inp = build(specs);

  it('funding = N/A và không có dòng điểm nào nhắc tới funding', () => {
    expect(inp.deriv.funding.quality).toBe('UNAVAILABLE');
    expect(inp.deriv.funding.note).toContain('N/A');
    const conf = scoreConfluence(inp, 'SHORT', 'edge-fail', null, 2);
    expect(conf.lines.some((l) => /funding/i.test(l.label))).toBe(false);
  });

  it('funding phẳng cũng không được cộng điểm', () => {
    const flatFr = {
      ...inp,
      deriv: {
        ...inp.deriv,
        funding: {
          quality: 'REAL' as const, venue: 'okx-swap', rate: 0.00005,
          nextFundingTime: null, markPrice: 100, flat: true, extreme: false, history: null,
          note: 'Funding phẳng — bỏ qua.',
        },
      },
    };
    const conf = scoreConfluence(flatFr, 'SHORT', 'edge-fail', null, 2);
    expect(conf.lines.some((l) => /funding/i.test(l.label))).toBe(false);
  });

  it('OI = N/A thì lý do ghi rõ N/A và không cộng điểm OI', () => {
    const rec = decideBias(inp);
    expect(rec.reasons.some((r) => r.includes('N/A'))).toBe(true);
    expect(rec.confluence.lines.some((l) => /^OI đồng hướng/.test(l.label))).toBe(false);
  });
});

describe('luật phát lệnh theo TF', () => {
  const specs: Spec[] = [
    ...valueBase(),
    { o: 100.4, h: 101.2, l: 100.3, c: 101.0, v: 160, tb: 110 },
    { o: 101.0, h: 103.5, l: 100.8, c: 100.9, v: 400, tb: 120 },
    { o: 100.9, h: 101.1, l: 100.2, c: 100.4, v: 300, tb: 90 },
  ];

  it('1D chưa đóng nến ngày → không bao giờ in LONG/SHORT', () => {
    const inp = { ...build(specs, '1d'), hasClosedBar: false };
    expect(decideBias(inp).bias).toBe('WAIT');
  });

  it('1h chưa có nến đóng → WAIT dù setup đẹp', () => {
    const inp = { ...build(specs, '1h'), hasClosedBar: false };
    expect(decideBias(inp).bias).toBe('WAIT');
  });

  it('score < 7 thì WAIT bất kể stage', () => {
    const inp = build(specs);
    const rec = decideBias(inp);
    if (rec.confluence.score < 7) expect(rec.bias).toBe('WAIT');
    else expect(rec.bias).toBe('SHORT');
  });

  it('plan text có đủ các dòng bắt buộc', () => {
    const rec = decideBias(build(specs));
    for (const k of ['Entry:', 'Trigger đóng:', 'SL:', 'TP1:', 'TP2:', 'Runner:', 'Hủy:', 'Lý do:', 'Cấm:']) {
      expect(rec.planText).toContain(k);
    }
  });
});
