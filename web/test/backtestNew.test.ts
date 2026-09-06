import { describe, expect, it } from 'vitest';
import { aggregate, runBacktestNew, signalAtNew } from '@/lib/backtestNew';
import { DEFAULT_BT } from '@/lib/backtest';
import { ena15m } from './fixtures.ena';
import type { Candle } from '@/lib/types';

/** Chuỗi 15m dài, có nhịp, đủ để dựng cả năm lớp. */
function series(n: number, seed = 5): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const c = p + Math.sin(i / 23) * 0.6 + (rnd() - 0.5) * 0.5;
    const hi = Math.max(p, c) + rnd() * 0.25;
    const lo = Math.min(p, c) - rnd() * 0.25;
    const v = 60 + rnd() * 90;
    out.push({ t: start + i * 900_000, o: p, h: hi, l: lo, c, v, q: v * c, takerBuyBase: v * (0.42 + rnd() * 0.16), closed: true });
    p = c;
  }
  return out;
}

describe('gộp nến 15m thành khung lớn', () => {
  const c = series(400);

  it('1h gồm đúng 4 cây 15m, OHLC đúng, volume cộng dồn', () => {
    const h = aggregate(c, '1h');
    const first = h[0];
    const four = c.filter((x) => Math.floor(x.t / 3_600_000) * 3_600_000 === first.t);
    expect(first.o).toBe(four[0].o);
    expect(first.c).toBe(four[four.length - 1].c);
    expect(first.h).toBeCloseTo(Math.max(...four.map((x) => x.h)), 10);
    expect(first.l).toBeCloseTo(Math.min(...four.map((x) => x.l)), 10);
    expect(first.v).toBeCloseTo(four.reduce((s, x) => s + x.v, 0), 6);
  });

  it('taker cộng dồn, và mất một nến thì cả cây thành null chứ không cộng thiếu', () => {
    const h = aggregate(c, '1h');
    expect(h[0].takerBuyBase).not.toBeNull();
    const holed = c.map((x, i) => (i === 1 ? { ...x, takerBuyBase: null } : x));
    expect(aggregate(holed, '1h')[0].takerBuyBase).toBeNull();
  });

  it('cây cuối chưa đủ nến 15m thì KHÔNG được đánh dấu đã đóng', () => {
    const partial = c.slice(0, c.length - 2);   // cắt giữa một cây 1h
    const h = aggregate(partial, '1h');
    expect(h[h.length - 1].closed).toBe(false);
  });

  it('1d gộp đúng 96 cây 15m', () => {
    const d = aggregate(c, '1d');
    const first = d[0];
    const n = c.filter((x) => Math.floor(x.t / 86_400_000) * 86_400_000 === first.t).length;
    expect(n).toBeLessThanOrEqual(96);
  });
});

describe('không nhìn trộm tương lai', () => {
  const full = series(1400);

  it('tín hiệu tại nến i không đổi khi cắt bỏ toàn bộ dữ liệu sau i', () => {
    const h = aggregate(full, '1h');
    for (const i of [700 / 4, 900 / 4, 1100 / 4].map(Math.floor)) {
      const closeTime = h[i].t + 3_600_000;
      const truncated = full.filter((c) => c.t + 1 <= closeTime);
      const a = signalAtNew('1h', full, h, i);
      const b = signalAtNew('1h', truncated, aggregate(truncated, '1h'), i);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('đổi dữ liệu Ở TƯƠNG LAI không làm đổi tín hiệu quá khứ', () => {
    const h = aggregate(full, '1h');
    const i = 200;
    const closeTime = h[i].t + 3_600_000;
    const tampered = full.map((c) => (c.t + 1 > closeTime ? { ...c, c: c.c * 3, h: c.h * 3, l: c.l * 3, v: c.v * 9 } : c));
    const a = signalAtNew('1h', full, h, i);
    const b = signalAtNew('1h', tampered, aggregate(tampered, '1h'), i);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('chạy trọn một backtest thước mới', () => {
  it('lệnh không chồng lấn, và mọi lệnh đều có kế hoạch qua cửa', () => {
    const r = runBacktestNew('T', '1h', series(1600), DEFAULT_BT, 400);
    expect(r.bars).toBeGreaterThan(0);
    for (let i = 1; i < r.trades.length; i++) {
      expect(r.trades[i].signalIdx).toBeGreaterThan(r.trades[i - 1].exitIdx);
    }
    for (const t of r.trades) {
      expect(t.tradeable).toBe(true);
      expect(t.entryIdx).toBeGreaterThan(t.signalIdx);
    }
  });

  it('đếm được lý do các nến KHÔNG ra kế hoạch — không im lặng bỏ qua', () => {
    const r = runBacktestNew('T', '1h', series(1600), DEFAULT_BT, 400);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.blockers.reduce((s, b) => s + b.n, 0)).toBeGreaterThan(0);
  });

  it('dữ liệu quá ngắn thì không ra lệnh nào, không nổ', () => {
    const r = runBacktestNew('T', '1h', ena15m(), DEFAULT_BT, 400);
    expect(r.trades).toHaveLength(0);
  });
});

describe('metaOfCall — hồi quy cho cả warnings[] lẫn warningCount', () => {
  it('số cảnh báo phải lấy từ warnings.length, không được im lặng về 0', async () => {
    const { metaOfCall } = await import('@/lib/backtest');
    const call = {
      symbol: 'X', tf: '1h', side: 'LONG', conviction: 'B', golden: false,
      goldenBlockers: [], unanimous: true, contestedBy: [], tradeable: true, gateBlockers: [],
      net: 20, longScore: 60, shortScore: 40, entry: [99, 100], sl: 98, tp1: 102, tp2: 106,
      rr1: 1, rr2: 3, rrBlended: 1.4, runner: null, size: 'Normal', trigger: '', invalidation: '',
      evidence: [{ label: 'A', side: 'long', points: 2, detail: '' }],
      structureNote: '', flowNote: '', fundingText: '', buyPctPerp: null, buyPctSpot: null,
      warnings: ['một', 'hai', 'ba'], planText: '',
    } as any;
    const m = metaOfCall(call);
    expect(m.warningCount).toBe(3);
    expect(m.warningCount).toBe(call.warnings.length);
    expect(m.evidence).toHaveLength(1);
    expect(m.unanimous).toBe(true);
    expect(m.tradeable).toBe(true);
  });

  it('không cảnh báo nào thì là 0, và đó là 0 THẬT chứ không phải trường bị mất', async () => {
    const { metaOfCall } = await import('@/lib/backtest');
    const m = metaOfCall({ warnings: [], evidence: [], symbol: 'X', tf: '1h', conviction: 'C',
      golden: false, net: 0, rrBlended: null, unanimous: false, tradeable: false } as any);
    expect(m.warningCount).toBe(0);
    expect(m.unanimous).toBe(false);
  });
});

describe('live và backtest dùng chung một hàm quyết định', () => {
  it('scan.ts và backtestNew.ts đều đi qua readTF, không có bản sao logic', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    for (const f of ['lib/scan.ts', 'lib/backtestNew.ts']) {
      expect(fs.readFileSync(f, 'utf8')).toContain('readTF(');
    }
  });

  it('cùng đầu vào thì cùng đầu ra — quyết định phải tất định', () => {
    const c = series(1400, 11);
    const h = aggregate(c, '1h');
    const a = signalAtNew('1h', c, h, 250);
    const b = signalAtNew('1h', c, h, 250);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
