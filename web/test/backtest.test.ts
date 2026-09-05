import { describe, expect, it } from 'vitest';
import { BT_WINDOW, DEFAULT_BT, blindDerivatives, runBacktest, signalAt, simulate, stats } from '@/lib/backtest';
import type { Candle } from '@/lib/types';
import type { DirectionalCall } from '@/lib/direct';

/** Chuỗi nến giả lập có nhịp, đủ dài để dựng profile. */
function series(n: number, seed = 7): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const start = Date.now() - (n + 5) * 3_600_000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 14) * 0.9;
    const noise = (rnd() - 0.5) * 0.8;
    const c = p + drift + noise;
    const hi = Math.max(p, c) + rnd() * 0.4;
    const lo = Math.min(p, c) - rnd() * 0.4;
    const v = 80 + rnd() * 120;
    out.push({ t: start + i * 3_600_000, o: p, h: hi, l: lo, c, v, q: v * c, takerBuyBase: v * (0.4 + rnd() * 0.2), closed: true });
    p = c;
  }
  return out;
}

describe('backtest không được nhìn trộm tương lai', () => {
  const full = series(400);

  it('tín hiệu tại nến i không đổi khi cắt bỏ toàn bộ nến sau i', () => {
    for (const i of [200, 260, 330]) {
      const withFuture = signalAt('T', '1h', full, i);
      const truncated = signalAt('T', '1h', full.slice(0, i + 1), i);
      expect(withFuture).toBeTruthy();
      // So bằng toàn bộ nội dung quyết định, không chỉ hướng
      expect(JSON.stringify(truncated)).toBe(JSON.stringify(withFuture));
    }
  });

  it('đổi dữ liệu Ở TƯƠNG LAI không làm đổi tín hiệu quá khứ', () => {
    const i = 250;
    const before = signalAt('T', '1h', full, i);
    const tampered = full.map((c, k) => (k > i ? { ...c, c: c.c * 3, h: c.h * 3, l: c.l * 3 } : c));
    const after = signalAt('T', '1h', tampered, i);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('cửa sổ profile bằng đúng cửa sổ của live', () => {
    expect(BT_WINDOW['15m']).toBe(192);
    expect(BT_WINDOW['1h']).toBe(168);
    expect(BT_WINDOW['4h']).toBe(126);
    expect(BT_WINDOW['1d']).toBe(90);
  });

  it('backtest chạy mù phái sinh — mọi trường phái sinh đều N/A', () => {
    const d = blindDerivatives();
    expect(d.funding.quality).toBe('UNAVAILABLE');
    expect(d.oi.quality).toBe('UNAVAILABLE');
    expect(d.perpTaker.quality).toBe('UNAVAILABLE');
  });
});

describe('mô phỏng lệnh', () => {
  const base = (over: Partial<DirectionalCall> = {}): DirectionalCall => ({
    symbol: 'T', tf: '1h', side: 'LONG', conviction: 'A', golden: false, goldenBlockers: [],
    net: 50, longScore: 75, shortScore: 25,
    entry: [99, 100], sl: 98, tp1: 102, tp2: 106,
    rr1: 1, rr2: 3, rrBlended: 1.4, runner: null, size: 'Normal',
    trigger: '', invalidation: '', evidence: [], structureNote: '', flowNote: '',
    fundingText: '', buyPctPerp: null, buyPctSpot: null, warnings: [], planText: '',
    ...over,
  });

  const bar = (o: number, h: number, l: number, c: number, i = 0): Candle =>
    ({ t: i * 3_600_000, o, h, l, c, v: 100, q: 100 * c, takerBuyBase: 50, closed: true });

  it('không chạm vùng entry thì KHÔNG tính là một lệnh', () => {
    const cs = [bar(105, 106, 104, 105, 0), ...Array.from({ length: 20 }, (_, i) => bar(105, 106, 104, 105, i + 1))];
    expect(simulate(cs, 0, base(), DEFAULT_BT)).toBeNull();
  });

  it('chạm SL trước → đúng -1R', () => {
    const cs = [bar(101, 101, 101, 101, 0), bar(100, 100, 97, 97, 1), bar(97, 97, 97, 97, 2)];
    const t = simulate(cs, 0, base(), DEFAULT_BT)!;
    expect(t.exitReason).toBe('sl');
    expect(t.r).toBe(-1);
  });

  it('cùng một nến chạm cả SL lẫn TP → tính SL trước (nghi ngờ chọn phía xấu)', () => {
    const cs = [bar(101, 101, 101, 101, 0), bar(100, 103, 97, 100, 1), bar(100, 100, 100, 100, 2)];
    const t = simulate(cs, 0, base(), DEFAULT_BT)!;
    expect(t.exitReason).toBe('sl');
    expect(t.r).toBe(-1);
  });

  it('chạm TP1 rồi TP2 → R = 0.5×R1 + 0.5×R2', () => {
    const cs = [bar(101, 101, 101, 101, 0), bar(100, 100, 99.5, 100, 1), bar(100, 103, 100, 102, 2), bar(102, 107, 102, 106, 3)];
    const t = simulate(cs, 0, base(), DEFAULT_BT)!;
    expect(t.hitTP1).toBe(true);
    expect(t.hitTP2).toBe(true);
    expect(t.exitReason).toBe('tp2');
    // entry 100, sl 98 → risk 2; R1 = 1, R2 = 3
    expect(t.r).toBeCloseTo(0.5 * 1 + 0.5 * 3, 6);
  });

  it('chạm TP1 rồi quay lại SL → lời một nửa, lỗ một nửa', () => {
    const cs = [bar(101, 101, 101, 101, 0), bar(100, 100, 99.5, 100, 1), bar(100, 103, 100, 102, 2), bar(102, 102, 97, 97, 3)];
    const t = simulate(cs, 0, base(), DEFAULT_BT)!;
    expect(t.exitReason).toBe('tp1-then-sl');
    expect(t.r).toBeCloseTo(0.5 * 1 + 0.5 * -1, 6);
  });

  it('short đối xứng: khớp ở mép dưới vùng entry', () => {
    const s = base({ side: 'SHORT', entry: [100, 101], sl: 102, tp1: 98, tp2: 94 });
    const cs = [bar(99, 99, 99, 99, 0), bar(99, 100.5, 99, 100, 1), bar(100, 100, 97, 97.5, 2), bar(97, 97, 93, 93.5, 3)];
    const t = simulate(cs, 0, s, DEFAULT_BT)!;
    expect(t.entry).toBe(100);
    expect(t.hitTP2).toBe(true);
    expect(t.r).toBeGreaterThan(0);
  });

  it('thống kê rỗng không làm nổ hàm', () => {
    const s = stats([]);
    expect(s.trades).toBe(0);
    expect(s.totalR).toBe(0);
  });
});

describe('chạy trọn một backtest', () => {
  it('ra danh sách lệnh và các lệnh không chồng lấn nhau', () => {
    const cs = series(500, 11);
    const trades = runBacktest('T', '1h', cs, DEFAULT_BT);
    expect(Array.isArray(trades)).toBe(true);
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i].signalIdx).toBeGreaterThan(trades[i - 1].exitIdx);
    }
    for (const t of trades) {
      expect(t.entryIdx).toBeGreaterThan(t.signalIdx);
      expect(t.exitIdx).toBeGreaterThanOrEqual(t.entryIdx);
    }
  });
});
