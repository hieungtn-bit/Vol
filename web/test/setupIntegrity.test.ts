import { describe, expect, it } from 'vitest';
import { aggregate, signalAtNew } from '@/lib/backtestNew';
import { SCORE_FLOOR } from '@/lib/confluence';
import type { Candle } from '@/lib/types';

function series(n: number, seed = 3): Candle[] {
  const out: Candle[] = [];
  let p = 100; let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const c = p + Math.sin(i / 19) * 0.8 + (rnd() - 0.5) * 0.45;
    const hi = Math.max(p, c) + rnd() * 0.22;
    const lo = Math.min(p, c) - rnd() * 0.22;
    const v = 70 + rnd() * 80;
    out.push({ t: start + i * 900_000, o: p, h: hi, l: lo, c, v, q: v * c, takerBuyBase: v * (0.4 + rnd() * 0.2), closed: true });
    p = c;
  }
  return out;
}

/** Mọi setup (kể cả dự kiến) trên một chuỗi dài — để kiểm bất biến hình học. */
function allSetups() {
  const c15 = series(2600);
  const h = aggregate(c15, '1h');
  const out: { r: NonNullable<ReturnType<typeof signalAtNew>>; i: number; h: Candle[] }[] = [];
  for (let i = 300; i < h.length - 30; i += 3) {
    const r = signalAtNew('1h', c15, h, i);
    if (r && (r.plan || r.prospect)) out.push({ r, i, h });
  }
  return out;
}

const S = allSetups();

describe('hình học lệnh — bất biến trên mọi setup dựng được', () => {
  it('có đủ mẫu để kiểm', () => expect(S.length).toBeGreaterThan(20));

  it('SL và TP nằm ĐÚNG PHÍA so với vùng vào lệnh', () => {
    for (const { r } of S) {
      const p = r.plan ?? r.prospect!;
      const entryRef = r.bias === 'mua' || (r.prospect && r.lines.length >= 0 && p.tp1 > p.sl)
        ? p.entry[1] : p.entry[0];
      const long = p.tp1 > p.sl;
      if (long) {
        expect(p.sl).toBeLessThan(p.entry[0]);
        expect(p.tp1).toBeGreaterThan(p.entry[1]);
        expect(p.tp2).toBeGreaterThan(p.tp1);
      } else {
        expect(p.sl).toBeGreaterThan(p.entry[1]);
        expect(p.tp1).toBeLessThan(p.entry[0]);
        expect(p.tp2).toBeLessThan(p.tp1);
      }
      expect(entryRef).toBeGreaterThan(0);
    }
  });

  it('vùng vào lệnh luôn có bề rộng dương và SL cách entry một khoảng thật', () => {
    for (const { r } of S) {
      const p = r.plan ?? r.prospect!;
      expect(p.entry[1]).toBeGreaterThan(p.entry[0]);
      const ref = p.tp1 > p.sl ? p.entry[1] : p.entry[0];
      expect(Math.abs(ref - p.sl)).toBeGreaterThan(0);
    }
  });

  it('R:R sau phí = 0.5×rr1 + 0.5×rr2 − phí, đúng công thức hàm mô phỏng', () => {
    for (const { r } of S) {
      const p = r.plan ?? r.prospect!;
      expect(p.rrNet).toBeCloseTo(0.5 * p.rr1 + 0.5 * p.rr2 - p.feeR, 1);
      expect(p.feeR).toBeGreaterThan(0);
    }
  });
});

describe('entry phải KHỚP ĐƯỢC sau khi có xác nhận', () => {
  it('vùng vào lệnh nằm trong tầm với của giá, không phải mức treo xa vô lý', () => {
    let reachable = 0;
    for (const { r, i, h } of S) {
      const p = r.plan ?? r.prospect!;
      const long = p.tp1 > p.sl;
      const ref = long ? p.entry[1] : p.entry[0];
      // Trong 12 nến kế tiếp, giá có chạm tới vùng vào lệnh không?
      const win = h.slice(i + 1, i + 13);
      if (win.some((b) => (long ? b.l <= ref : b.h >= ref))) reachable++;
    }
    // Không đòi 100% — lệnh chờ không khớp là chuyện bình thường. Nhưng nếu tỷ
    // lệ khớp quá thấp thì mức vào lệnh đang bị đặt sai chỗ chứ không phải thị
    // trường không tới.
    expect(reachable / S.length).toBeGreaterThan(0.4);
  });
});

describe('không dùng dữ liệu tương lai', () => {
  const c15 = series(2600);
  const h = aggregate(c15, '1h');

  it('cắt bỏ toàn bộ dữ liệu sau nến i không đổi setup tại i', () => {
    for (const i of [400, 500, 600]) {
      const closeTime = h[i].t + 3_600_000;
      const cut = c15.filter((c) => c.t + 1 <= closeTime);
      const a = signalAtNew('1h', c15, h, i);
      const b = signalAtNew('1h', cut, aggregate(cut, '1h'), i);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('bóp méo dữ liệu tương lai không đổi setup quá khứ', () => {
    const i = 450;
    const closeTime = h[i].t + 3_600_000;
    const bad = c15.map((c) => (c.t + 1 > closeTime ? { ...c, c: c.c * 5, h: c.h * 5, l: c.l * 5, v: c.v * 20 } : c));
    expect(JSON.stringify(signalAtNew('1h', bad, aggregate(bad, '1h'), i)))
      .toBe(JSON.stringify(signalAtNew('1h', c15, h, i)));
  });
});

describe('sàn 7 không bị nới', () => {
  it('mọi setup ĐỦ ĐIỀU KIỆN đều có điểm ≥ 7 và có kế hoạch thật', () => {
    for (const { r } of S) {
      if (r.setup_status === 'du_dieu_kien') {
        expect(r.score).toBeGreaterThanOrEqual(SCORE_FLOOR);
        expect(r.gate.pass).toBe(true);
        expect(r.plan).not.toBeNull();
      }
    }
  });

  it('setup chưa đạt KHÔNG bao giờ có kế hoạch thật, nhưng vẫn nêu được thiếu gì', () => {
    for (const { r } of S) {
      if (r.setup_status !== 'du_dieu_kien') {
        expect(r.plan).toBeNull();
        expect(r.missing_conditions.length).toBeGreaterThan(0);
      }
    }
  });

  it('thiếu dữ liệu không bao giờ bị trình bày như không có cơ hội', () => {
    for (const { r } of S) {
      if (r.data_status === 'DATA_INSUFFICIENT') {
        expect(r.setup_status).toBe('thieu_du_lieu');
        expect(r.missing_conditions.join(' ')).toContain('Thiếu dữ liệu');
      }
    }
  });
});
