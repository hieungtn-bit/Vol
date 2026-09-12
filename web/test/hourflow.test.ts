/**
 * Hourflow 1H — số liệu ENAUSDT 11–12/09/2026, nến ĐÃ ĐÓNG.
 */
import { describe, expect, it } from 'vitest';
import {
  NGUONG_EVENT, noiNhip, pocTuNenVol, readBar, sessionTb, type HFBar,
} from '../lib/hourflow';

const H = 3_600_000;
const T = (iso: string) => Date.parse(iso);

const b = (
  iso: string, o: number, h: number, l: number, c: number, v: number,
  takerBuyBase: number | null = null, closed = true,
): HFBar => ({ t: T(iso), o, h, l, c, v, takerBuyBase, closed });

/**
 * Phiên 11/09 (ICT). Trung vị 71.7m; cây 21:00 = 246.1m vượt 3× trung vị nên
 * phải bị loại khỏi TB — nếu không, mọi cây sau đó đều trông như vol chết.
 */
const PHIEN_1109: HFBar[] = [
  b('2026-09-11T13:00:00Z', 0.1520, 0.1535, 0.1512, 0.1530, 68.0e6),
  b('2026-09-11T14:00:00Z', 0.1530, 0.1544, 0.1525, 0.1538, 71.7e6),
  b('2026-09-11T15:00:00Z', 0.1538, 0.1550, 0.1530, 0.1541, 74.2e6),
  b('2026-09-11T16:00:00Z', 0.1541, 0.1552, 0.1534, 0.1546, 66.9e6),
  b('2026-09-11T17:00:00Z', 0.1546, 0.1560, 0.1540, 0.1552, 80.1e6),
  b('2026-09-11T18:00:00Z', 0.1552, 0.1566, 0.1544, 0.1558, 71.7e6),
  b('2026-09-11T19:00:00Z', 0.1558, 0.1576, 0.1548, 0.1562, 95.3e6),
  // 20:00 và 21:00 là hai cây vol lớn nhất — cụm tạo ra túi stop 0.1505–0.1566.
  b('2026-09-11T20:00:00Z', 0.1562, 0.1566, 0.1505, 0.1520, 182.4e6, 79.0e6),
  b('2026-09-11T21:00:00Z', 0.1520, 0.1560, 0.1500, 0.1530, 246.1e6, 105.0e6),
];

describe('TB phiên', () => {
  it('loại đúng một cây max khi nó vượt 3× trung vị', () => {
    const s = sessionTb(PHIEN_1109, T('2026-09-11T21:59:00Z'));
    expect(s.median).toBeCloseTo(74.2e6, -4);
    expect(s.loaiCay).toBe(246.1e6);            // cây 21:00 bị loại
    expect(s.soCay).toBe(PHIEN_1109.length - 1);
    expect(s.tb).toBeLessThan(246.1e6);
    expect(s.eventThreshold).toBe(NGUONG_EVENT);
  });

  it('không loại gì khi max chưa vượt 3× trung vị', () => {
    const deu = PHIEN_1109.slice(0, 7);          // bỏ hai cây to
    const s = sessionTb(deu, T('2026-09-11T20:00:00Z'));
    expect(s.loaiCay).toBeNull();
    expect(s.soCay).toBe(7);
  });

  it('phiên non (<8 cây đóng) thì lấy 12 cây đóng gần nhất', () => {
    // 02:00 UTC = 09:00 ICT: phiên mới chỉ có 2 cây, phải rơi về cửa sổ trượt.
    const s = sessionTb(PHIEN_1109, T('2026-09-12T02:00:00Z'));
    expect(s.soCay).toBeGreaterThan(2);
  });
});

describe('đọc một cây', () => {
  const tb = sessionTb(PHIEN_1109, T('2026-09-11T21:59:00Z')).tb;

  it('cây 1H 08:00 12/09 vol 24.8m là vol chết, không phải event', () => {
    const c0800 = b('2026-09-12T01:00:00Z', 0.14093, 0.14193, 0.14065, 0.14148, 24.8e6);
    const r = readBar(c0800, tb);
    expect(r.vsTb!).toBeLessThan(0.5);
    expect(r.event).toBe(false);
    // In ra số thật, không làm tròn thành "vol yếu".
    expect(r.vsTb!.toFixed(2)).toMatch(/^0\.\d\d$/);
  });

  it('cây 21:00 đóng GIỮA cây và delta âm', () => {
    const r = readBar(PHIEN_1109[8], tb);
    expect(r.closePos).toBe('giua');
    // delta = 2×105.0m − 246.1m = −36.1m → phe bán chủ động nhiều hơn.
    expect(r.delta!).toBeCloseTo(-36.1e6, -5);
    expect(r.imb!).toBeLessThan(0);
  });

  it('event là tỷ số ≥ 3.0 và chỉ tính trên cây ĐÃ ĐÓNG', () => {
    const to = b('2026-09-11T22:00:00Z', 0.153, 0.158, 0.152, 0.157, 4 * tb);
    expect(readBar(to, tb).event).toBe(true);
    const toDangMo = { ...to, closed: false };
    expect(readBar(toDangMo, tb).event).toBe(false);
  });

  it('range = 0 thì bỏ chỗ đóng thay vì bịa', () => {
    const phang = b('2026-09-11T22:00:00Z', 0.15, 0.15, 0.15, 0.15, 10e6);
    expect(readBar(phang, tb).closePos).toBeNull();
  });

  it('không có taker thì delta null, không đoán bằng hướng nến', () => {
    expect(readBar(PHIEN_1109[0], tb).delta).toBeNull();
  });
});

describe('POC ước từ nến vol', () => {
  it('dải chồng của 20:00 + 21:00 chứa SL 0.15254', () => {
    const d = pocTuNenVol(PHIEN_1109)!;
    // Cây 19:00 (95.3m) không cùng hạng với 182.4m nên không được kéo dải hẹp lại.
    expect(d.bars).toHaveLength(2);
    expect(d).not.toBeNull();
    expect(d.low).toBeLessThan(0.15254);
    expect(d.high).toBeGreaterThan(0.15254);
    expect(d.bars).toContain(T('2026-09-11T20:00:00Z'));
    expect(d.bars).toContain(T('2026-09-11T21:00:00Z'));
  });

  it('chồng rỗng thì tách cụm và lấy cụm tổng vol lớn hơn', () => {
    // Ba cây cùng hạng vol nhưng cây 10:00 ở một vùng giá hẳn khác → giao rỗng.
    const roi: HFBar[] = [
      b('2026-09-11T10:00:00Z', 0.20, 0.21, 0.199, 0.205, 90e6),   // cụm trên, một mình
      b('2026-09-11T11:00:00Z', 0.10, 0.105, 0.099, 0.101, 88e6),  // cụm dưới
      b('2026-09-11T12:00:00Z', 0.101, 0.104, 0.0995, 0.102, 85e6),
    ];
    const d = pocTuNenVol(roi)!;
    expect(d.low).toBeGreaterThan(0.09);
    expect(d.high).toBeLessThan(0.11);
    expect(d.bars).not.toContain(T('2026-09-11T10:00:00Z'));
    // Cụm dưới thắng vì TỔNG vol 173m > 90m, không phải vì cây nào to nhất.
    expect(d.bars).toHaveLength(2);
  });

  it('cây đang mở không được vào POC', () => {
    const mo = [...PHIEN_1109, b('2026-09-11T22:00:00Z', 0.153, 0.90, 0.01, 0.157, 999e6, null, false)];
    const d = pocTuNenVol(mo)!;
    expect(d.bars).not.toContain(T('2026-09-11T22:00:00Z'));
  });

  it('dưới hai cây đóng thì trả null, không dựng dải một cây', () => {
    expect(pocTuNenVol(PHIEN_1109.slice(0, 1))).toBeNull();
  });
});

describe('nói nhịp', () => {
  it('tối đa 5 câu và có số thật', () => {
    const tb = sessionTb(PHIEN_1109, T('2026-09-11T21:59:00Z')).tb;
    const s = noiNhip(PHIEN_1109, tb);
    expect(s.length).toBeLessThanOrEqual(5);
    expect(s[0]).toMatch(/× TB phiên/);
    // Nguồn delta phải gọi đúng tên chợ: field 9 ở repo này là kline SPOT.
    expect(s.join(' ')).toContain('Delta taker spot');
    expect(s.join(' ')).not.toMatch(/delta.*perp/i);
  });

  it('thiếu TB thì im, không đoán', () => {
    expect(noiNhip(PHIEN_1109, null)).toEqual([]);
    expect(noiNhip([], 100)).toEqual([]);
  });
});

void H;
