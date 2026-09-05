import { describe, expect, it } from 'vitest';
import { GOLD_MARGIN, SCORE_FLOOR, scoreSide, verdict, type ConfluenceInput } from '@/lib/confluence';
import { buildLayers, tradingLayer } from '@/lib/layers';
import { readState } from '@/lib/vpState';
import { barDelta, findDivergence, hourFlow, spotVsPerp } from '@/lib/deltaDiv';
import { ena15m, ena1h, ictHour } from './fixtures.ena';
import type { Candle, OIInfo } from '@/lib/types';

const NOW = ictHour(5, 21);
const oiNA: OIInfo = {
  quality: 'UNAVAILABLE', venue: null, open: null, unit: null,
  chg1h: null, chg24h: null, read: 'na', squeezeWarning: false, oiOverVol: null, note: 'N/A',
};

function inp(over: Partial<ConfluenceInput> = {}): ConfluenceInput {
  const c1h = ena1h();
  const L = buildLayers(ena15m(), c1h, NOW);
  const layer = tradingLayer(L)!;
  return {
    tf: '1h', layer, state: readState(layer, c1h, '1h'), closed: c1h,
    last: c1h[c1h.length - 1].c, volMedian20: 44e6, tfDelta: null,
    spotPerpAgree: false, fundingPoints: 0, divergence: null, oi: oiNA,
    slPct: 1.5, mixedLayer: false, ...over,
  };
}

describe('delta lấy từ trường taker của sàn, không suy từ hướng đóng cửa', () => {
  it('delta = 2·takerBuy − volume', () => {
    const c: Candle = { t: 0, o: 1, h: 1, l: 1, c: 1, v: 100, q: 100, takerBuyBase: 70, closed: true };
    expect(barDelta(c)).toBe(40);
  });
  it('không có taker thì trả null, không đoán', () => {
    const c: Candle = { t: 0, o: 1, h: 1, l: 1, c: 1, v: 100, q: 100, takerBuyBase: null, closed: true };
    expect(barDelta(c)).toBeNull();
  });
  it('cây 20:00 của ENA có delta ÂM, cây 13:00 có delta DƯƠNG', () => {
    const c = ena1h();
    const at = (h: number) => c.find((x) => x.t === ictHour(5, h))!;
    expect(barDelta(at(20))!).toBeLessThan(0);
    expect(barDelta(at(13))!).toBeGreaterThan(0);
  });
  it('cây 19:00 delta gần bằng 0 — mua chủ động KHÔNG thắng dù vol lớn', () => {
    const c = ena1h();
    const at19 = c.find((x) => x.t === ictHour(5, 19))!;
    const d = barDelta(at19)!;
    expect(Math.abs(d) / at19.v).toBeLessThan(0.02);
  });
});

describe('hourflow đọc effort vs result', () => {
  const rows = hourFlow(ena1h(), 12);
  it('trả về 8–12 cây đã đóng', () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBeLessThanOrEqual(12);
  });
  it('cây 20:00 vol lớn + đóng gần thấp + delta âm → chấp nhận xuống', () => {
    const r = rows.find((x) => x.t === ictHour(5, 20))!;
    expect(r.volVsMean).toBeGreaterThan(1.3);
    expect(r.delta!).toBeLessThan(0);
    expect(r.read).toContain('chấp nhận xuống');
  });
  it('vol nhỏ thì KHÔNG đọc gì — im lặng là kết luận hợp lệ', () => {
    const small = rows.filter((r) => r.volVsMean < 1.3);
    for (const r of small) expect(r.read).toContain('không đọc');
  });
});

describe('spot và hợp đồng tách riêng, không lấy trung bình', () => {
  it('nến khác giờ thì không kết luận đồng thuận', () => {
    const a = ena1h();
    const b = a.map((c) => ({ ...c, t: c.t + 1 }));
    expect(spotVsPerp(a, b).agree).toBe(false);
  });
  it('cùng giờ và cùng dấu mới gọi là đồng thuận', () => {
    const a = ena1h();
    expect(spotVsPerp(a, a).agree).toBe(true);
    expect(spotVsPerp(a, a).text).toContain('cùng nghiêng');
  });
  it('lệch thì ghi lệch', () => {
    const a = ena1h();
    const flipped = a.map((c) => ({ ...c, takerBuyBase: c.v - (c.takerBuyBase ?? 0) }));
    const r = spotVsPerp(a, flipped);
    expect(r.agree).toBe(false);
    expect(r.text).toContain('Lệch');
  });
});

describe('phân kỳ chỉ khi có HAI swing rõ', () => {
  it('dữ liệu ngắn thì không kết luận', () => {
    expect(findDivergence(ena1h().slice(0, 8), '1h')).toBeNull();
  });
  it('không có taker thì không kết luận', () => {
    const c = ena1h().map((x) => ({ ...x, takerBuyBase: null }));
    expect(findDivergence(c, '1h')).toBeNull();
  });
  it('nếu có thì phải kèm đúng hai swing và một trạng thái hợp lệ', () => {
    const d = findDivergence(ena1h(), '1h');
    if (d) {
      expect(d.swings).toHaveLength(2);
      expect(['dang_chay', 'da_fill', 'het_hieu_luc']).toContain(d.status);
    }
  });
});

describe('sàn điểm 7 là luật cứng — LỖI #5 của bản cũ', () => {
  it('ENA 1h chiều–tối: điểm dưới sàn và bias phải là đứng ngoài', () => {
    const v = verdict(inp(), { fullSize: true, halfSize: true, blocked: null });
    expect(v.score).toBeLessThan(SCORE_FLOOR);
    expect(v.bias).toBe('dung_ngoai');
    expect(v.size).toBeNull();
    expect(v.reasons.join(' ')).toContain('Còn trong vùng');
  });

  it('còn trong vùng thì KHÔNG mở lệnh mới, kể cả khi điểm cao', () => {
    const base = inp();
    const v = verdict(
      { ...base, spotPerpAgree: true, tfDelta: -1e6, fundingPoints: -1 },
      { fullSize: true, halfSize: true, blocked: null },
    );
    expect(v.bias).toBe('dung_ngoai');
  });

  it('đứng giữa điểm kiểm soát bị trừ 4 — đủ để dìm mọi kèo', () => {
    const base = inp();
    const mid = (base.layer.poc[0] + base.layer.poc[1]) / 2;
    const s = scoreSide({ ...base, last: mid }, 'mua');
    expect(s.lines.some((l) => l.points === -4)).toBe(true);
  });

  it('lớp còn trộn hai cụm bị trừ 2 và phải nói ra', () => {
    const s = scoreSide({ ...inp(), mixedLayer: true }, 'ban');
    const l = s.lines.find((x) => x.points === -2);
    expect(l).toBeTruthy();
    expect(l!.label).toContain('trộn hai cụm');
  });

  it('cắt rộng hơn 5% giá bị trừ 1.5', () => {
    const s = scoreSide({ ...inp(), slPct: 7 }, 'mua');
    expect(s.lines.some((l) => l.points === -1.5)).toBe(true);
  });

  it('lớp 10 ngày không được cộng điểm "giá tại mép"', () => {
    const base = inp();
    const coarse = { ...base.layer, layer: '10d' as const };
    const s = scoreSide({ ...base, layer: coarse, last: base.state.edge.val }, 'mua');
    expect(s.lines.some((l) => l.label.includes('Giá tại VAL'))).toBe(false);
  });

  it('hạng vàng đòi lệch điểm ≥ 4 và không vế nào âm', () => {
    const v = verdict(inp(), { fullSize: true, halfSize: true, blocked: null });
    if (v.golden) expect(v.margin).toBeGreaterThanOrEqual(GOLD_MARGIN);
  });
});
