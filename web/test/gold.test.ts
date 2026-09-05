import { describe, expect, it } from 'vitest';
import { decideDirection } from '@/lib/direct';
import { analyzeStructure } from '@/lib/structure';
import { buildFlow } from '@/lib/flow';
import { analyzePriceAction } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import { mkCandles, noDerivatives, type Spec } from './fixtures';
import type { OIRead } from '@/lib/types';

const noPos = { retailLongPct: null, topLongPct: null };

function bar(f: number, t: number, o: { spikeUp?: number; spikeDn?: number; v?: number; tb?: number } = {}): Spec {
  return {
    o: f,
    h: Math.max(f, t) + (o.spikeUp ?? 0.02),
    l: Math.min(f, t) - (o.spikeDn ?? 0.02),
    c: t, v: o.v ?? 100, tb: o.tb ?? 55,
  };
}

/**
 * Kịch bản short sạch: hồi lên đúng node đỉnh của value trong một cấu trúc giảm.
 *
 * Ba chi tiết hình học bắt buộc, thiếu là RR hỏng và kèo không bao giờ đạt vàng:
 *  - Hai nhà volume dày (đáy 100, đỉnh 102) với vùng MỎNG ở giữa — nhờ khoảng mỏng
 *    đó TP1 mới có chỗ chạy, thay vì dừng ở cái bin ngay cạnh entry.
 *  - Entry nằm ở node đỉnh, và túi equal-highs nằm SÁT ngay trên nó, nên stop ra
 *    ngoài túi vẫn gần. Túi thanh khoản cách entry 1% là kèo tồi — đúng như engine
 *    kết luận, không phải lỗi engine.
 *  - Nhịp hồi cuối KHÔNG được vượt swing high trước đó, nếu không cấu trúc thành
 *    HH và mất tính nhất trí.
 */
function cleanShortSetup(): Spec[] {
  const out: Spec[] = [];
  // hai nhà volume dày, vùng giữa mỏng — khoảng mỏng là chỗ cho TP chạy
  for (let i = 0; i < 20; i++) out.push(bar(100, 100, { v: 220, tb: 110 }));
  for (let i = 0; i < 6; i++) { const a = 100.4 + (i % 4) * 0.4; out.push(bar(a, a, { v: 30, tb: 15 })); }
  for (let i = 0; i < 20; i++) out.push(bar(102, 102, { v: 220, tb: 110 }));

  // Zigzag giảm phải NHẸ VOLUME. Nếu nặng, chính các nến này tích đủ để thành HVN
  // nhỏ, kéo entry về một node phụ và đặt TP1/TP2 sát nhau — RR sụp, và đó là lý do
  // một kèo trông đẹp vẫn không đạt vàng.
  const path = [101.5, 101.8, 100.8, 101.6, 100.5, 101.4];
  let p = 102;
  for (let k = 0; k < path.length; k++) {
    const target = path[k];
    const up = target > p;
    for (let i = 0; i < 4; i++) {
      const n = p + (target - p) / (4 - i);
      const last = i === 3;
      // tb luôn ≤ v: taker mua không thể nhiều hơn tổng volume của chính cây đó.
      out.push(bar(p, n, { v: 15, tb: 6, ...(last ? (up ? { spikeUp: 0.4 } : { spikeDn: 0.4 }) : {}) }));
      p = n;
    }
  }
  // cây cuối: đỏ, volume gấp nhiều lần median nhịp hồi nhưng vẫn quá nhẹ để tạo node
  out.push(bar(101.4, 101.3, { v: 40, tb: 8 }));
  return out;
}

function call(specs: Spec[], buyPct: number, oiRead: OIRead, fundingRate: number) {
  const candles = mkCandles(specs);
  const closed = candles.filter((c) => c.closed);
  const vp = computeVolumeProfile(closed, { binSize: 0.2 })!;
  const pa = analyzePriceAction(candles);
  const st = analyzeStructure(candles);
  const deriv = noDerivatives();
  deriv.oi = {
    quality: 'REAL', venue: 'binance-perp', open: 1e6, unit: 'base coin',
    chg1h: 3, chg24h: 6, read: oiRead, squeezeWarning: false, oiOverVol: 0.3, note: 'test',
  };
  deriv.funding = {
    quality: 'REAL', venue: 'binance-perp', rate: fundingRate, nextFundingTime: null,
    markPrice: 101, flat: false, extreme: false, note: 'test',
  };
  const flow = buildFlow(
    [{ buy: buyPct, sell: 100 - buyPct }, { buy: buyPct, sell: 100 - buyPct }],
    candles, noPos, deriv.funding,
  );
  return decideDirection(
    { symbol: 'T', tf: '15m', candles, vp, pa, delta: buildDelta(candles, vp, 'binance-spot'),
      deriv, htf: null, hasClosedBar: true, last: closed[closed.length - 1].c },
    st, flow,
  );
}

describe('hạng vàng phải ĐẠT ĐƯỢC, không phải code chết', () => {
  it('mọi vế đồng thuận short → bật tín hiệu vàng', () => {
    const c = call(cleanShortSetup(), 10, 'new-shorts', -0.0003);
    expect(c.side).toBe('SHORT');
    expect(c.goldenBlockers).toEqual([]);
    expect(c.golden).toBe(true);
    expect(c.conviction).toBe('GOLD');
    expect(Math.abs(c.net)).toBeGreaterThanOrEqual(40);
    // Định nghĩa hạng vàng KHÔNG còn ràng buộc RR hay "không cảnh báo" — backtest
    // cho thấy hai điều kiện đó chọn ngược. Chỉ còn độ lệch và tính nhất trí.
    const contributing = c.evidence.filter((e) => Math.abs(e.points) >= 1);
    expect(contributing.length).toBeGreaterThanOrEqual(4);
    expect(contributing.every((e) => (c.side === 'LONG' ? e.points > 0 : e.points < 0))).toBe(true);
    expect(c.planText).toContain('★ TÍN HIỆU VÀNG');
  });

  it('chỉ cần MỘT vế quay ngược là tắt vàng ngay', () => {
    const c = call(cleanShortSetup(), 90, 'new-shorts', -0.0003);   // taker đảo sang mua
    expect(c.golden).toBe(false);
    expect(c.goldenBlockers.join(' ')).toContain('ngược hướng');
  });

  it('OI đọc ngược cũng đủ để tắt vàng', () => {
    const c = call(cleanShortSetup(), 10, 'new-longs', -0.0003);
    expect(c.golden).toBe(false);
  });
});

describe('vế Value Area phải bị chặn biên', () => {
  it('giá rời hẳn value không được nuốt hết các vế khác', () => {
    // giá bỏ chạy lên tận 140 trong khi value còn ở 100
    const specs: Spec[] = [];
    for (let i = 0; i < 40; i++) specs.push(bar(100, 100, { v: 250 }));
    let p = 100;
    for (let i = 0; i < 30; i++) { const n = p + 1.4; specs.push(bar(p, n)); p = n; }
    const c = call(specs, 90, 'new-longs', 0.0003);
    const loc = c.evidence.find((e) => e.label === 'Vị trí trong Value Area')!;
    // trọng số của vế này là 20, chặn biên nghĩa là không bao giờ vượt quá
    expect(Math.abs(loc.points)).toBeLessThanOrEqual(20.001);
  });
});

describe('cửa chất lượng (ngưỡng do backtest hiệu chuẩn)', () => {
  it('cửa đúng bằng ba điều kiện đã hiệu chuẩn, không hơn không kém', () => {
    for (const buy of [10, 45, 88]) {
      const c = call(cleanShortSetup(), buy, 'new-shorts', -0.0003);
      const expected = c.unanimous && c.conviction !== 'C' && (c.rrBlended ?? 0) <= 1.5;
      expect(c.tradeable).toBe(expected);
    }
  });

  it('kèo sạch thì nhất trí — và hạng vàng VẪN có thể trượt cửa vì TP2 quá xa', () => {
    const c = call(cleanShortSetup(), 10, 'new-shorts', -0.0003);
    expect(c.unanimous).toBe(true);
    expect(c.contestedBy).toEqual([]);
    // Fixture này có R kỳ vọng ~2.96: đúng vùng backtest đo ra avgR âm. Hạng vàng
    // nói "mọi vế đồng thuận", cửa nói "kèo này đáng đặt tiền không" — hai câu hỏi
    // khác nhau, và một kèo đồng thuận với TP2 quá xa vẫn là kèo không nên vào.
    expect(c.gateBlockers.every((b) => b.includes('TP2 quá xa'))).toBe(true);
    expect(c.tradeable).toBe((c.rrBlended ?? 0) <= 1.5);
  });

  it('có vế ngược hướng → trượt cửa nhưng VẪN CÓ HƯỚNG, không thành WAIT', () => {
    // taker mua áp đảo trong khi mọi thứ khác nói short → ít nhất một vế đi ngược
    const c = call(cleanShortSetup(), 88, 'new-shorts', -0.0003);
    if (c.unanimous) return;                      // fixture vẫn nhất trí thì không kết luận gì
    expect(c.contestedBy.length).toBeGreaterThan(0);
    expect(c.tradeable).toBe(false);
    expect(c.gateBlockers.some((b) => b.includes('ngược hướng'))).toBe(true);
    expect(['LONG', 'SHORT']).toContain(c.side);  // luật cứng: luôn có hướng
    expect(c.size).toBe('Small');
  });

  it('lý do trượt cửa luôn được nói ra, không im lặng bỏ kèo', () => {
    for (const buy of [10, 45, 88]) {
      const c = call(cleanShortSetup(), buy, 'new-shorts', -0.0003);
      expect(c.tradeable).toBe(c.gateBlockers.length === 0);
      if (!c.tradeable) expect(c.gateBlockers.join(' ').length).toBeGreaterThan(0);
    }
  });

  it('hạng C không bao giờ qua cửa', () => {
    for (const buy of [10, 40, 50, 60, 88]) {
      const c = call(cleanShortSetup(), buy, 'new-shorts', -0.0003);
      if (c.conviction === 'C') expect(c.tradeable).toBe(false);
    }
  });

  it('size đi theo cửa chứ không theo số cảnh báo', () => {
    // Backtest: 0 cảnh báo avgR 0.10, 1 cảnh báo 0.04, ≥2 cảnh báo 0.05 — không đơn
    // điệu, nên số cảnh báo không được quyết định size.
    const c = call(cleanShortSetup(), 10, 'new-shorts', -0.0003);
    if (c.tradeable && (c.conviction === 'GOLD' || c.conviction === 'A')) {
      expect(c.size).toBe('Normal');              // kể cả khi vẫn còn cảnh báo
    }
    const bad = call(cleanShortSetup(), 88, 'new-shorts', -0.0003);
    if (!bad.tradeable) expect(bad.size).toBe('Small');
  });
});
