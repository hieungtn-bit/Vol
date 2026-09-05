import { describe, expect, it } from 'vitest';
import { buildLayers, findEventBar, tradingLayer } from '@/lib/layers';
import { STATE_VI, edgeRejection, heldOutside, insidePoc, readState } from '@/lib/vpState';
import { fitProfile, pocBand } from '@/lib/ruler';
import { splitClusters } from '@/lib/layers';
import { BTC_OLD_VA, ENA_NEW_CLUSTER, ENA_OLD_CLUSTER, btc1d, ena15m, ena1h, ictHour } from './fixtures.ena';
import type { Candle } from '@/lib/types';

const NOW = ictHour(5, 21);   // ngay sau cây 20:00 đóng

describe('tách lớp — cụm cũ và cụm mới không được ở chung một thước', () => {
  const L = buildLayers(ena15m(), ena1h(), NOW);

  it('bắt đúng cây event 19:00 ngày 4/9 và loại chính nó khi tính trung bình', () => {
    const e = findEventBar(ena1h())!;
    expect(e).not.toBeNull();
    expect(e.candle.t).toBe(ictHour(4, 19));
    expect(e.mult).toBeGreaterThan(3);
  });

  it('lớp sau-event bắt đầu từ đúng cây event', () => {
    expect(L.after_event).not.toBeNull();
    expect(L.after_event!.from).toBe(ictHour(4, 19));
  });

  it('vùng giá trị lớp sau-event là cụm MỚI, không nuốt vách cũ 0.1687–0.1710', () => {
    const va = L.after_event!.vp.va70;
    expect(va.high).toBeLessThan(ENA_OLD_CLUSTER[0]);
    expect(va.low).toBeGreaterThan(0.155);
  });

  it('điểm kiểm soát lớp sau-event nằm trong cụm mới 0.1613–0.1664', () => {
    const [lo, hi] = L.after_event!.poc;
    const mid = (lo + hi) / 2;
    expect(mid).toBeGreaterThanOrEqual(ENA_NEW_CLUSTER[0] - 0.002);
    expect(mid).toBeLessThanOrEqual(ENA_NEW_CLUSTER[1] + 0.002);
  });

  it('lớp dùng để đặt lệnh không bao giờ là 10 ngày hay 48 giờ', () => {
    const t = tradingLayer(L)!;
    expect(['24h', 'after_event', 'session_4h']).toContain(t.layer);
  });
});

describe('ENA chiều–tối 5/9: máy phải nói ĐỨNG NGOÀI vì còn trong vùng', () => {
  const L = buildLayers(ena15m(), ena1h(), NOW);
  const t = tradingLayer(L)!;
  const c1h = ena1h();

  it('trạng thái 1h là còn trong vùng', () => {
    const r = readState(t, c1h, '1h');
    expect(r.state).toBe('trong_vung');
    expect(r.heldOutside).toBe(false);
  });

  it('mép đang sống nằm quanh 0.162–0.166, không phải 0.146–0.171', () => {
    const r = readState(t, c1h, '1h');
    expect(r.edge.val).toBeGreaterThan(0.158);
    expect(r.edge.vah).toBeLessThan(0.170);
    expect(r.edge.vah - r.edge.val).toBeLessThan(0.012);
  });

  it('cây 20:00 đóng 0.16361 — VẪN đứng ngoài, chưa đủ để bán', () => {
    // Đề bài: chỉ đủ điều kiện xem bán sau nến ĐÓNG dưới 0.16310. Cây 20:00 đóng
    // 0.16361, tức còn trên mốc đó — máy phải nói đứng ngoài, không được bán.
    const last = c1h[c1h.length - 1];
    expect(last.c).toBeGreaterThan(0.16310);
    expect(readState(t, c1h, '1h').state).toBe('trong_vung');
  });

  it('chỉ khi có hai nến đóng dưới 0.16310 thì trạng thái mới đổi', () => {
    const bar = (c: number) => ({ ...c1h[c1h.length - 1], t: c1h[c1h.length - 1].t + 3_600_000, c, l: c - 0.0005 });
    // Đề bài: "dưới 0,162 sau quét 0,1659". Hai nến đóng dưới 0.162.
    const withBreak = [...c1h, bar(0.16180), bar(0.16120)];
    const r = readState(t, withBreak, '1h');
    expect(r.state).not.toBe('trong_vung');
    expect(r.side).toBe('duoi');
  });

  it('câu chữ sinh ra từ chính trạng thái — không thể vừa trong vừa ngoài', () => {
    const r = readState(t, c1h, '1h');
    const lower = r.text.toLowerCase();
    expect(lower).toContain(STATE_VI[r.state]);
    for (const other of Object.values(STATE_VI)) {
      if (other !== STATE_VI[r.state]) expect(lower).not.toContain(other);
    }
  });
});

describe('BTC 1d giá ~79700 vs vùng cũ 59500–67000', () => {
  const c = btc1d();

  it('phải là CHẤP NHẬN NGOÀI VÙNG phía trên, không phải giữa value', () => {
    const f = fitProfile(c, '10d')!;
    const layer = {
      ...f, poc: pocBand(c, f.vp) as [number, number], bars: c.length,
      from: c[0].t, to: c[c.length - 1].t, split: splitClusters(c, f.step),
    };
    const r = readState(layer, c, '1d');
    expect(r.state).toBe('chap_nhan_ngoai');
    expect(r.side).toBe('tren');
    expect(r.text).not.toContain('còn trong vùng');
  });

  it('giá nằm trên trần vùng cũ, và máy không được gọi đó là giữa vùng', () => {
    const last = c[c.length - 1].c;
    expect(last).toBeGreaterThan(BTC_OLD_VA[1]);
  });
});

describe('nến CHƯA ĐÓNG không bao giờ được tính là chấp nhận', () => {
  const mk = (c: number, closed: boolean): Candle =>
    ({ t: 0, o: c, h: c + 1, l: c - 1, c, v: 10, q: 10 * c, takerBuyBase: 5, closed });

  it('hai cây đóng ngoài mới là giữ', () => {
    expect(heldOutside([mk(90, true), mk(120, true)], 100, 80)).toBeNull();
    expect(heldOutside([mk(120, true), mk(121, true)], 100, 80)).toBe('tren');
    expect(heldOutside([mk(70, true), mk(69, true)], 100, 80)).toBe('duoi');
  });

  it('một cây ra rồi cây sau chui về là QUÉT, không phải chấp nhận', () => {
    expect(heldOutside([mk(120, true), mk(95, true)], 100, 80)).toBeNull();
  });
});

describe('giá đứng giữa điểm kiểm soát là chỗ bị cấm', () => {
  it('nhận ra đúng dải', () => {
    const c = ena15m();
    const f = fitProfile(c, '24h')!;
    const layer = {
      ...f, poc: pocBand(c, f.vp) as [number, number], bars: c.length,
      from: 0, to: 0, split: splitClusters(c, f.step),
    };
    const [lo, hi] = layer.poc;
    expect(insidePoc(layer, (lo + hi) / 2)).toBe(true);
    expect(insidePoc(layer, hi + (hi - lo))).toBe(false);
  });
});
