/**
 * T0–T9 — dựng lại đúng các thẻ ENAUSDT đã in sai ngày 11–12/09/2026.
 * CI đỏ nếu bất kỳ thẻ nào trong số này quay lại trạng thái cũ.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { apDungH9, daToiTP, evaluate, resetKhoaHet, tpHitTol, type BarK, type LifecycleInput } from '../lib/lifecycle';
import { buildFundingHistory } from '../lib/derivatives';

const bar = (o: number, h: number, l: number, c: number, v: number, closed: boolean, t = 0): BarK =>
  ({ t, o, h, l, c, v, closed });

/** Mặc định "lành" — mỗi test chỉ đặt lại đúng những gì bug nói. */
function co(p: Partial<LifecycleInput>): LifecycleInput {
  return {
    symbol: 'ENAUSDT', tf: '4h', side: 'SHORT',
    entryLow: 0.147, entryHigh: 0.150, sl: 0.15254, tp1: 0.140, tp2: 0.133,
    triggerText: '4H đóng dưới 0.1470', triggerLevel: 0.1470,
    last: 0.1480, ts: Date.parse('2026-09-11T22:34:00Z'),
    openK: null, lastClosedK: bar(0.150, 0.1505, 0.1465, 0.1466, 2e8, true),
    rr: 1.2, atr1h: 0.0025, low24h: 0.1300, high24h: 0.1600,
    low4hMaxVol: 0.1300, high4hMaxVol: 0.1600,
    cum1h: null, rejected1h: true,
    tp1OutsideVa: false, volRatio: 1.2, opposingLegs: 0,
    tpBreaksUnbackedLevel: false, barsSinceIssued: 1,
    ...p,
  };
}

const T2000 = Date.parse('2026-09-11T20:00:00Z');
const T2100 = Date.parse('2026-09-11T21:00:00Z');
let idT0 = '';
let congT0: string[] = [];

/**
 * THẺ 22:34 — mức giá và R của đúng tấm thẻ đã in sai. Cả bản điện (T0) lẫn
 * /strict (T13) đọc CÙNG object này, nên không đường nào được lặng lẽ mang một
 * bộ mức giá khác vào so sánh.
 *
 * R = 0.49 là con số desk ghi cho thẻ đó. Nó KHÔNG khớp với khoảng cách TP mà
 * chính thẻ in ra (entry→TP1 rộng hơn nhiều) — đấy là một điểm vênh riêng của
 * tấm thẻ thật, chép lại đúng như vậy chứ không suy ngược ra số cho tròn.
 */
const THE_2234 = {
  side: 'SHORT' as const, tf: '4h' as const,
  entryLow: 0.147, entryHigh: 0.150, sl: 0.15254, tp1: 0.140, tp2: 0.133,
  triggerText: '4H đóng dưới 0.1470', triggerLevel: 0.147,
  rr: 0.49,
};

/** Thị trường lúc 22:34 — cùng một lát cắt cho cả hai đường. */
const CHO_2234 = {
  last: 0.15400, ts: Date.parse('2026-09-11T22:34:00Z'),
  // Cụm 1H 20:00+21:00 — SL 0.15254 nằm GIỮA cụm, đúng túi stop.
  cum1h: { low: 0.1505, high: 0.1566, bars: [T2000, T2100] },
  openK: bar(0.1540, 0.15764, 0.13980, 0.1540, 7.3e8, false),
  lastClosedK: bar(0.1500, 0.1560, 0.1500, 0.1540, 2.0e8, true),
};

/**
 * Thị trường 12/09 09:00 ICT — nến ĐÃ ĐÓNG, không bịa.
 *   4H 03:00 đóng  o0.14236 h0.14354 l0.13793 c0.14036  vol 193.5m
 *   4H 07:00 đang mở o0.14036 h0.14193 l0.13997
 *   1H 08:00 đóng  o0.14093 h0.14193 l0.14065 c0.14148  vol 24.8m (0.56×)
 *   15m 08:45 đóng o0.14145 h0.14193 l0.14124 c0.14148
 */
const CHO_0900 = {
  last: 0.14148, ts: Date.parse('2026-09-12T02:00:00Z'),   // 09:00 ICT = 02:00 UTC
  low24h: 0.13793, high24h: 0.15764,
  low4hMaxVol: 0.13793, high4hMaxVol: 0.15764,
  atr1h: 0.0025,
  cum1h: { low: 0.1505, high: 0.1566, bars: [T2000, T2100] },
};
const K4H_0300 = bar(0.14236, 0.14354, 0.13793, 0.14036, 193.5e6, true);
const K4H_0700 = bar(0.14036, 0.14193, 0.13997, 0.14148, 80e6, false);
const K1H_0800 = bar(0.14093, 0.14193, 0.14065, 0.14148, 24.8e6, true);
const K15_0845 = bar(0.14145, 0.14193, 0.14124, 0.14148, 5e6, true);

const log: string[] = [];
const ghi = (ten: string, i: LifecycleInput, v: ReturnType<typeof evaluate>) => {
  log.push(
    `${ten} ${new Date(i.ts).toISOString().slice(0, 16).replace('T', ' ')} ${i.symbol} ${i.tf} ` +
    `last=${i.last} sl=${i.sl} ${v.state} id=${v.id} hạng=${v.grade} | ${v.reason} | ` +
    `cổng hỏng: ${v.failedGates.join(',') || '—'}${v.softFlags.length ? ' | mềm: ' + v.softFlags.join(',') : ''}`,
  );
};

describe('vòng đời thẻ — ENAUSDT 11–12/09/2026', () => {
  beforeEach(() => resetKhoaHet());

  it('T0 4H SHORT lúc nến 4H còn mở, last đã xuyên SL', () => {
    const i = co({ ...THE_2234, ...CHO_2234 });
    const v = evaluate(i);
    idT0 = v.id;
    congT0 = [...v.failedGates].sort();
    ghi('T0', i, v);
    expect(['HET', 'CAM']).toContain(v.state);
    for (const g of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H8', 'H10']) expect(v.failedGates).toContain(g);
    expect(v.grade).not.toBe('A');
    expect(v.banner).not.toBe('ĐỦ ĐIỀU KIỆN');
    expect(v.noiDuocHuong).toBe(false);
  });

  it('T1 22:42 cùng id, last vẫn trên SL → vẫn HET', () => {
    const a = co({ last: 0.15400, openK: bar(0.1540, 0.15764, 0.1398, 0.1540, 7.3e8, false) });
    evaluate(a);
    const i = co({ last: 0.15362, ts: Date.parse('2026-09-11T22:42:00Z'),
      openK: bar(0.1540, 0.15764, 0.1398, 0.15362, 7.4e8, false) });
    const v = evaluate(i);
    ghi('T1', i, v);
    expect(v.state).toBe('HET');
    // Câu lý do phải dựng từ last CỦA LẦN QUÉT NÀY, không phải chuỗi cache từ T0.
    expect(v.reason).toBe('last 0.15362 đã xuyên SL 0.15254');
    expect(v.reason).not.toContain('0.154 đã');
  });

  it('T2 quét lại → HET được giữ, không tự nâng lại', () => {
    const v0 = evaluate(co({ ...THE_2234, ...CHO_2234 }));
    // Lần quét sau giá rơi lại vào vùng và nến đã đóng — thẻ cũ vẫn phải HET.
    const i = co({
      last: 0.1485, ts: Date.parse('2026-09-11T23:10:00Z'), openK: null,
      lastClosedK: bar(0.1520, 0.1525, 0.1460, 0.1465, 3e8, true),
    });
    const v = evaluate(i);
    ghi('T2', i, v);
    expect(v.id).toBe(v0.id);
    expect(v.id).toBe(idT0);
    expect(v.state).toBe('HET');
    expect(v.slHitTs).toBe(v0.slHitTs);
  });

  it('T3 15m LONG với last dưới SL', () => {
    const i = co({
      tf: '15m', side: 'LONG', entryLow: 0.151, entryHigh: 0.15150, sl: 0.14984,
      tp1: 0.1560, tp2: 0.1600, triggerText: '15m đóng trên 0.15150', triggerLevel: 0.15150,
      last: 0.14890, ts: Date.parse('2026-09-11T22:59:00Z'),
      openK: null, lastClosedK: bar(0.1500, 0.1502, 0.1485, 0.1487, 1e7, true),
      high24h: 0.1600, high4hMaxVol: 0.1600,
    });
    const v = evaluate(i);
    ghi('T3', i, v);
    expect(v.state).toBe('HET');
    for (const g of ['H2', 'H3', 'H4']) expect(v.failedGates).toContain(g);
    expect(v.noiDuocHuong).toBe(false);
  });

  it('T4 cùng lúc 4H SHORT cũng HET — cấm hai thẻ ngược chiều cùng SONG', () => {
    const iL = co({
      tf: '15m', side: 'LONG', entryLow: 0.151, entryHigh: 0.15150, sl: 0.14984,
      tp1: 0.1560, tp2: 0.1600, triggerText: '15m đóng trên 0.15150', triggerLevel: 0.15150,
      last: 0.14890, ts: Date.parse('2026-09-11T22:59:00Z'),
      lastClosedK: bar(0.1500, 0.1502, 0.1485, 0.1487, 1e7, true),
      high24h: 0.1600, high4hMaxVol: 0.1600,
    });
    const iS = co({
      last: 0.14890, ts: Date.parse('2026-09-11T22:59:00Z'),
      openK: bar(0.1540, 0.15764, 0.1398, 0.1489, 7.5e8, false),
      lastClosedK: bar(0.1500, 0.1560, 0.1500, 0.1540, 2.0e8, true),
    });
    const vL = evaluate(iL);
    const vS = evaluate(iS);
    ghi('T4', iS, vS);
    expect(vL.state).toBe('HET');
    expect(vS.state).not.toBe('SONG');
    expect([vL.state, vS.state].filter((s) => s === 'SONG')).toHaveLength(0);
  });

  it('T5 12/09 03:44 — short sát đáy 24h, ATR lấy từ cây 1H thật', () => {
    // ATR_1H lấy từ biên độ cây 1H 05:00 (0.00194). Không bịa SL: SL đặt ngay
    // trên mép cụm 1H, đúng cách thẻ thật dựng, để H11 là thứ duy nhất quyết định.
    const cum = { low: 0.1400, high: 0.1428, bars: [T2000, T2100] };
    const ATR_1H_0500 = 0.00194;
    const i = co({
      tf: '15m', last: 0.14101, ts: Date.parse('2026-09-12T03:44:00Z'),
      entryLow: 0.1405, entryHigh: 0.1415, sl: cum.high + 0.0001, tp1: 0.1360, tp2: 0.1320,
      triggerText: '15m đóng dưới 0.1405', triggerLevel: 0.1405,
      openK: null, lastClosedK: bar(0.1415, 0.1416, 0.1400, 0.1402, 1e7, true),
      low24h: 0.13944, low4hMaxVol: 0.13944, atr1h: ATR_1H_0500, cum1h: cum,
    });
    const v = evaluate(i);
    ghi('T5', i, v);
    // last − low24h = 0.00157 < ATR 0.00194 → H11 phải chặn.
    expect(i.last - i.low24h!).toBeLessThan(ATR_1H_0500);
    expect(v.failedGates).toContain('H11');
    expect(v.state).not.toBe('SONG');
  });

  it('T6 07:32 15m SHORT R=0.26, TP1 ngay tại giá', () => {
    const i = co({
      tf: '15m', last: 0.14050, ts: Date.parse('2026-09-12T07:32:00Z'),
      entryLow: 0.1403, entryHigh: 0.1408, sl: 0.1425, tp1: 0.14000, tp2: 0.1390,
      triggerText: '15m đóng dưới 0.1403', triggerLevel: 0.1403, rr: 0.26,
      openK: null, lastClosedK: bar(0.1404, 0.1409, 0.1402, 0.1405, 1e7, true),
      low24h: 0.13944, low4hMaxVol: 0.13944,
    });
    const v = evaluate(i);
    ghi('T6', i, v);
    expect(['HET', 'CAM']).toContain(v.state);
    expect(v.grade).not.toBe('A');
  });

  it('T7 07:32 1H SHORT — cây 06:00 đóng đúng CAO cây, TP1 ≈ last', () => {
    const i = co({
      tf: '1h', last: 0.14050, ts: Date.parse('2026-09-12T07:32:00Z'),
      entryLow: 0.1410, entryHigh: 0.1420, sl: 0.1445, tp1: 0.14016, tp2: 0.1380,
      triggerText: '1H đóng dưới 0.1410', triggerLevel: 0.1410,
      openK: null,
      lastClosedK: bar(0.14000, 0.14036, 0.13990, 0.14036, 1e7, true),
      low24h: 0.13944, low4hMaxVol: 0.13944,
    });
    const v = evaluate(i);
    ghi('T7', i, v);
    // Dùng đúng hàm sai số của hệ, không gõ lại con số.
    expect(daToiTP(i.last, i.tp1, i.atr1h)).toBe(true);
    expect(Math.abs(i.last - i.tp1)).toBeLessThanOrEqual(tpHitTol(i.last, i.atr1h));
    expect(v.state).toBe('HET');
    expect(v.reason).toContain('đã tới chốt');
    // Cây 1H 06:00 đóng ĐÚNG CAO cây → không được khoá hướng SHORT.
    expect(v.softFlags).toContain('S2');
    expect(v.khoaHuong).not.toBe('SHORT');
    expect(v.khoaHuong).toBeNull();
    expect(v.noiDuocHuong).toBe(false);
    expect(v.state).not.toBe('SONG');
  });

  it('T8 07:32 4H SHORT — giá dưới vùng vào, đúng là chờ kéo lại', () => {
    const i = co({
      tf: '4h', last: 0.14050, ts: Date.parse('2026-09-12T07:32:00Z'),
      entryLow: 0.142, entryHigh: 0.143, sl: 0.1465, tp1: 0.1330, tp2: 0.1280,
      triggerText: '4H đóng dưới 0.142', triggerLevel: 0.142,
      openK: null, lastClosedK: bar(0.1430, 0.1432, 0.1400, 0.1405, 3e8, true),
      low24h: 0.1300, low4hMaxVol: 0.1300, rejected1h: true,
    });
    const v = evaluate(i);
    ghi('T8', i, v);
    expect(v.state).toBe('CHO_GIA');
    expect(v.banner).toBe('CHỜ GIÁ VÀO — KHÔNG MỞ');
  });

  it('T9 07:32 1D SHORT TP xuyên cụm tháng — ngày không được mở lệnh', () => {
    const i = co({
      tf: '1d', last: 0.14050, ts: Date.parse('2026-09-12T07:32:00Z'),
      entryLow: 0.1400, entryHigh: 0.1410, sl: 0.1500, tp1: 0.111, tp2: 0.096,
      triggerText: '1D đóng dưới 0.140', triggerLevel: 0.140,
      openK: null, lastClosedK: bar(0.1450, 0.1460, 0.1390, 0.1405, 9e8, true),
      low24h: 0.1300, low4hMaxVol: 0.1300, tpBreaksUnbackedLevel: true,
    });
    const v = evaluate(i);
    ghi('T9', i, v);
    expect(v.state).not.toBe('SONG');
    expect(v.failedGates).toContain('H13');
  });

  it('T10 22:34 — 15m HẾT thì 4H cùng hướng không được SONG hạng A', () => {
    const ts = Date.parse('2026-09-11T22:34:00Z');
    // 15m: last đã xuyên SL → HẾT.
    const i15 = co({
      tf: '15m', ts, last: 0.15400, entryLow: 0.1470, entryHigh: 0.1490, sl: 0.15254,
      tp1: 0.1400, tp2: 0.1330, triggerText: '15m đóng dưới 0.1470', triggerLevel: 0.1470,
      openK: null, lastClosedK: bar(0.1520, 0.1522, 0.1500, 0.1505, 1e7, true),
    });
    // 4H: dựng thành thẻ đủ điều kiện, để chỉ H9 là thứ hạ hạng.
    const i4h = co({
      tf: '4h', ts, last: 0.1480, entryLow: 0.1470, entryHigh: 0.1490, sl: 0.1520,
      tp1: 0.1400, tp2: 0.1350, triggerText: '4H đóng dưới 0.1490', triggerLevel: 0.1490,
      openK: null, lastClosedK: bar(0.1500, 0.1502, 0.1470, 0.1475, 3e8, true),
      rr: 1.4,
    });
    const v15 = evaluate(i15);
    const v4h = evaluate(i4h);
    ghi('T10', i4h, v4h);
    expect(v15.state).toBe('HET');
    expect(v4h.state).toBe('SONG');
    expect(v4h.grade).toBe('A');
    apDungH9([{ side: 'SHORT', v: v15 }, { side: 'SHORT', v: v4h }]);
    expect(v4h.grade).not.toBe('A');
    expect(v4h.failedGates).toContain('H9');
  });

  it('T11 funding — hai kỳ đảo dấu dưới ngưỡng phẳng, cấm in "phẳng"', () => {
    // 23:00 short trả long (−0.00074%) rồi 07:00 long trả short (+0.00500%).
    // Cả hai dưới ngưỡng phẳng — bản cũ gộp thành 0 và in "phẳng 12 kỳ".
    const h = buildFundingHistory([
      0.0000500, 0.0000500, 0.0000500, 0.0000500, 0.0000500,
      -0.0000074,   // 23:00 short trả long
      0.0000500,    // 07:00 long trả short
      0.0000500,
    ]);
    log.push(`T11 funding rawFlips=${h?.rawFlips} | ${h?.text}`);
    expect(h).not.toBeNull();
    expect(h!.rawFlips).toBeGreaterThanOrEqual(1);
    expect(h!.rawFlips).toBe(2);
    // Cấm mọi biến thể "phẳng N kỳ".
    expect(h!.text).not.toMatch(/phẳng \d+/);
    expect(h!.text).not.toMatch(/Funding phẳng/);
    expect(h!.text).toContain('ĐỔI DẤU');
    expect(h!.rates.length).toBeLessThanOrEqual(8);
  });

  it('T12 08:15 — nến 15m 08:00 đóng nửa trên thì thẻ SHORT không SONG', () => {
    const i = co({
      tf: '15m', side: 'SHORT', last: 0.14159, ts: Date.parse('2026-09-12T08:15:00Z'),
      entryLow: 0.1414, entryHigh: 0.1422, sl: 0.1440, tp1: 0.1380, tp2: 0.1350,
      triggerText: '15m đóng dưới 0.1422', triggerLevel: 0.1422,
      openK: null,
      // 08:00: o 0.1410 h 0.1420 l 0.1405 c 0.1418 → đóng ở 87% chiều cao cây.
      lastClosedK: bar(0.1410, 0.1420, 0.1405, 0.1418, 1e7, true),
      low24h: 0.1300, low4hMaxVol: 0.1300, rr: 1.3, rejected1h: true,
    });
    const v = evaluate(i);
    ghi('T12', i, v);
    expect(v.softFlags).toContain('S2');
    expect(v.state).not.toBe('SONG');
    expect(v.grade).not.toBe('A');
    expect(v.khoaHuong).toBeNull();
  });

  // ==========================================================================
  // T13–T16 — ĐƯỜNG /strict (Recommendation). Cùng evaluate(), cùng cardId().
  // Dựng thẻ strict qua đúng bộ chuyển `strictSangThe` mà scan.ts dùng, để test
  // gãy nếu ai đó cho /strict một máy trạng thái riêng.
  // ==========================================================================

  /** Bản rút gọn của `tuStrict()` trong scan.ts: Recommendation → thẻ có mức. */
  function strictSangThe(r: {
    symbol: string; bias: 'LONG' | 'SHORT' | 'WAIT';
    entry: [number, number] | null; sl: number | null; tp1: number | null; tp2: number | null;
    trigger: string; triggerLevel: number | null; rr1: number | null; rr2: number | null;
    rrSan?: number | null;
    warnings: string[]; lines: { label: string; points: number }[];
  }) {
    if (r.bias === 'WAIT' || !r.entry || r.sl == null || r.tp1 == null || r.tp2 == null) return null;
    return {
      side: r.bias, entryLow: r.entry[0], entryHigh: r.entry[1],
      sl: r.sl, tp1: r.tp1, tp2: r.tp2,
      triggerText: r.trigger, triggerLevel: r.triggerLevel,
      // Cùng công thức `tuStrict()` trong scan.ts; `rrSan` là R thẻ đã mang sẵn.
      rr: r.rrSan ?? (r.rr1 != null && r.rr2 != null ? 0.5 * r.rr1 + 0.3 * r.rr2 : null),
      tp1OutsideVa: r.warnings.some((w) => w.includes('TP1') && w.includes('VA')),
      opposingLegs: r.lines.filter((l) => l.points < 0
        && ['Taker', 'Price Action', 'Delta'].some((t) => l.label.includes(t))).length,
    };
  }

  interface TheMuc {
    side: 'LONG' | 'SHORT'; tf: LifecycleInput['tf'];
    entryLow: number; entryHigh: number; sl: number; tp1: number; tp2: number;
    triggerText: string; triggerLevel: number; rr: number;
  }

  /** Thẻ → Recommendation. R đi thẳng qua, không suy ngược ra rr1/rr2 giả. */
  function recTuThe(t: TheMuc) {
    return {
      symbol: 'ENAUSDT', bias: t.side, entry: [t.entryLow, t.entryHigh] as [number, number],
      sl: t.sl, tp1: t.tp1, tp2: t.tp2, trigger: t.triggerText, triggerLevel: t.triggerLevel,
      rr1: null, rr2: null, rrSan: t.rr, warnings: [] as string[],
      lines: [] as { label: string; points: number }[],
    };
  }

  const strict = (r: Parameters<typeof strictSangThe>[0], p: Partial<LifecycleInput>) => {
    const the = strictSangThe(r)!;
    return co({ ...the, ...p });
  };

  it('T13 /strict 22:34 — CÙNG thẻ, CÙNG thị trường ⇒ cùng id, state và tập cổng', () => {
    // Đi qua adapter strict, nhưng đọc ĐÚNG `THE_2234` + `CHO_2234` của T0.
    // Nếu ai đó cho /strict một bộ đầu vào khác (thiếu cụm 1H, R khác), test này
    // gãy — đó chính là chỗ T13 từng thiếu H5/H6.
    const i = co({ ...strictSangThe(recTuThe(THE_2234))!, tf: THE_2234.tf, ...CHO_2234 });
    const v = evaluate(i);
    ghi('T13', i, v);
    expect(v.state).toBe('HET');
    expect(v.banner).toBe('TÍN HIỆU HẾT — KHÔNG MỞ');
    expect(v.grade).not.toBe('A');
    // Một id, một vòng đời.
    expect(v.id).toBe('ENAUSDT-4h-SHORT-etb5vc');
    expect(v.id).toBe(idT0);
    // TẬP cổng hỏng phải trùng T0 (thứ tự không cần giống).
    expect([...v.failedGates].sort()).toEqual(congT0);
    expect(v.failedGates).toContain('H5');
    expect(v.failedGates).toContain('H6');
    // R của thẻ này dưới 0.80 — đúng R desk ghi, không nhét số cho tròn.
    expect(i.rr!).toBeLessThan(0.8);
  });

  it('T14 /strict 07:32 ENA 4H SHORT — entry nằm trên giá, chờ kéo lại', () => {
    const i = strict({
      symbol: 'ENAUSDT', bias: 'SHORT', entry: [0.142, 0.143], sl: 0.1465,
      tp1: 0.133, tp2: 0.128, trigger: '4H đóng dưới 0.1420', triggerLevel: 0.142,
      rr1: 1.0, rr2: 1.6, warnings: [], lines: [],
    }, {
      tf: '4h', last: 0.14050, ts: Date.parse('2026-09-12T07:32:00Z'),
      openK: null, lastClosedK: bar(0.143, 0.1432, 0.140, 0.1405, 3e8, true),
      low24h: 0.1300, low4hMaxVol: 0.1300,
    });
    const v = evaluate(i);
    ghi('T14', i, v);
    expect(v.state).toBe('CHO_GIA');
    expect(v.banner).toBe('CHỜ GIÁ VÀO — KHÔNG MỞ');
    expect(v.state).not.toBe('SONG');
  });

  it('T15 /strict 07:32 ENA 1D SHORT TP=0.111 — ngày không được mở lệnh', () => {
    const i = strict({
      symbol: 'ENAUSDT', bias: 'SHORT', entry: [0.1400, 0.1410], sl: 0.1500,
      tp1: 0.111, tp2: 0.096, trigger: '1D đóng dưới 0.1400', triggerLevel: 0.140,
      rr1: 1.0, rr2: 1.6, warnings: [], lines: [],
    }, {
      tf: '1d', last: 0.14050, ts: Date.parse('2026-09-12T07:32:00Z'),
      openK: null, lastClosedK: bar(0.145, 0.146, 0.139, 0.1405, 9e8, true),
      low24h: 0.1300, low4hMaxVol: 0.1300, tpBreaksUnbackedLevel: true,
    });
    const v = evaluate(i);
    ghi('T15', i, v);
    expect(v.state).not.toBe('SONG');
    expect(['CAM', 'HET', 'CHO_GIA']).toContain(v.state);
    expect(v.failedGates).toContain('H13');
  });

  it('T16 /strict 22:59 — 15m LONG HẾT thì 4H SHORT không SONG hạng A', () => {
    const ts = Date.parse('2026-09-11T22:59:00Z');
    const i15 = strict({
      symbol: 'ENAUSDT', bias: 'LONG', entry: [0.151, 0.15150], sl: 0.14984,
      tp1: 0.156, tp2: 0.160, trigger: '15m đóng trên 0.15150', triggerLevel: 0.15150,
      rr1: 1.0, rr2: 1.6, warnings: [], lines: [],
    }, {
      tf: '15m', last: 0.14890, ts,
      openK: null, lastClosedK: bar(0.150, 0.1502, 0.1485, 0.1487, 1e7, true),
      high24h: 0.1600, high4hMaxVol: 0.1600,
    });
    const i4h = strict({
      symbol: 'ENAUSDT', bias: 'SHORT', entry: [0.1470, 0.1490], sl: 0.1520,
      tp1: 0.1400, tp2: 0.1350, trigger: '4H đóng dưới 0.1490', triggerLevel: 0.1490,
      rr1: 1.4, rr2: 2.0, warnings: [], lines: [],
    }, {
      tf: '4h', last: 0.1480, ts,
      openK: null, lastClosedK: bar(0.1500, 0.1502, 0.1470, 0.1475, 3e8, true),
    });
    const v15 = evaluate(i15);
    const v4h = evaluate(i4h);
    expect(v15.state).toBe('HET');
    expect(v4h.state).toBe('SONG');
    apDungH9([{ side: 'LONG', v: v15 }, { side: 'SHORT', v: v4h }]);
    // Ngược hướng thì H9 không chạm — nhưng hai thẻ SONG ngược chiều là cấm.
    expect([v15.state, v4h.state].filter((x) => x === 'SONG')).toHaveLength(1);
    // Cùng hướng thì phải hạ hạng.
    const vCung = evaluate(strict({
      symbol: 'ENAUSDT', bias: 'SHORT', entry: [0.147, 0.150], sl: 0.15254,
      tp1: 0.140, tp2: 0.133, trigger: '4H đóng dưới 0.1470', triggerLevel: 0.147,
      rr1: 1.0, rr2: 1.6, warnings: [], lines: [],
    }, {
      tf: '15m', last: 0.154, ts,
      openK: bar(0.154, 0.15764, 0.1398, 0.154, 7.3e8, false),
      lastClosedK: bar(0.150, 0.156, 0.150, 0.154, 2e8, true),
    }));
    apDungH9([{ side: 'SHORT', v: vCung }, { side: 'SHORT', v: v4h }]);
    ghi('T16', i4h, v4h);
    expect(vCung.state).toBe('HET');
    expect(v4h.grade).not.toBe('A');
    expect(v4h.failedGates).toContain('H9');
  });

  // ==========================================================================
  // T17–T19 — lát cắt thị trường 12/09 09:00 ICT. Mỗi thẻ chạy HAI LẦN: một lần
  // qua đường bản điện, một lần qua adapter /strict. Hai đường phải ra CÙNG
  // state và CÙNG id — khác một chữ là có não thứ hai.
  // ==========================================================================

  /** Chạy một thẻ qua cả hai đường; ném nếu hai bên lệch. */
  function haiDuong(ten: string, the: TheMuc, cho: Partial<LifecycleInput>) {
    const iBd = co({ ...the, ...cho });
    const iSt = co({ ...strictSangThe(recTuThe(the))!, tf: the.tf, ...cho });
    const vBd = evaluate(iBd);
    resetKhoaHet();                      // đường thứ hai phải tính lại từ đầu
    const vSt = evaluate(iSt);
    ghi(`${ten} bản-điện`, iBd, vBd);
    ghi(`${ten} /strict  `, iSt, vSt);
    expect(vSt.id).toBe(vBd.id);
    expect(vSt.state).toBe(vBd.state);
    expect([...vSt.failedGates].sort()).toEqual([...vBd.failedGates].sort());
    return vBd;
  }

  it('T17 09:00 4H SHORT — entry 0.142–0.143 trên giá 0.14148, chờ kéo lại', () => {
    const v = haiDuong('T17', {
      side: 'SHORT', tf: '4h', entryLow: 0.142, entryHigh: 0.143, sl: 0.14546,
      tp1: 0.1340, tp2: 0.1280, triggerText: '4H đóng dưới 0.1420', triggerLevel: 0.142,
      rr: 1.45,
    }, { ...CHO_0900, openK: K4H_0700, lastClosedK: K4H_0300, rejected1h: true });
    expect(v.state).toBe('CHO_GIA');
    expect(v.banner).toBe('CHỜ GIÁ VÀO — KHÔNG MỞ');
    expect(v.state).not.toBe('SONG');
    expect(v.grade).not.toBe('A');
    // last − low_24h = 0.00355 > ATR_1H 0.0025 → H11 KHÔNG được bắt.
    expect(CHO_0900.last - CHO_0900.low24h).toBeGreaterThan(CHO_0900.atr1h);
    expect(v.failedGates).not.toContain('H11');
  });

  it('T18 09:00 1H SHORT — nến 08:00 đóng nửa trên', () => {
    const v = haiDuong('T18', {
      side: 'SHORT', tf: '1h', entryLow: 0.1412, entryHigh: 0.1420, sl: 0.1436,
      tp1: 0.1380, tp2: 0.1355, triggerText: '1H đóng dưới 0.1420', triggerLevel: 0.1420,
      rr: 1.30,
    }, { ...CHO_0900, openK: null, lastClosedK: K1H_0800, rejected1h: true, volRatio: 0.56 });
    expect(v.state).not.toBe('SONG');
    expect(v.softFlags).toContain('S2');
    expect(v.khoaHuong).toBeNull();
    expect(v.softFlags).toContain('S4');   // vol 24.8m = 0.56× median
    expect(v.grade).not.toBe('A');
  });

  it('T19 09:00 15m SHORT TP1 0.14000 — chưa có nến 1H từ chối mép cụm', () => {
    const v = haiDuong('T19', {
      side: 'SHORT', tf: '15m', entryLow: 0.1412, entryHigh: 0.1418, sl: 0.1428,
      tp1: 0.14000, tp2: 0.1385, triggerText: '15m đóng dưới 0.1418', triggerLevel: 0.1418,
      rr: 1.10,
    }, { ...CHO_0900, openK: null, lastClosedK: K15_0845, rejected1h: false });
    expect(['HET', 'CAM']).toContain(v.state);
    expect(v.state).not.toBe('SONG');
    expect(v.grade).not.toBe('A');
    // Giá đã rời hẳn cụm 0.1505–0.1566 và CHƯA hề kéo lại để 1H đóng từ chối mép.
    expect(v.failedGates).toContain('H12');
  });

  it('H9 hạ hạng A khi khung khác cùng hướng đang TRƯỢT', () => {
    const song = evaluate(co({
      tf: '1h', last: 0.1480, entryLow: 0.1470, entryHigh: 0.1490, sl: 0.1520,
      tp1: 0.1400, tp2: 0.1350, triggerLevel: 0.1490, triggerText: '1H đóng dưới 0.1490',
      openK: null, lastClosedK: bar(0.1500, 0.1502, 0.1470, 0.1475, 1e8, true),
      rr: 1.4, rejected1h: true,
    }));
    expect(song.state).toBe('SONG');
    expect(song.grade).toBe('A');
    const cam = evaluate(co({ tf: '4h', last: 0.1480, rr: 0.3 }));
    apDungH9([{ side: 'SHORT', v: song }, { side: 'SHORT', v: cam }]);
    expect(song.grade).toBe('B');
    expect(song.failedGates).toContain('H9');
  });

  it('in log T0–T9', () => {
    // eslint-disable-next-line no-console
    console.log('\n' + log.join('\n') + '\n');
    expect(log.length).toBeGreaterThanOrEqual(23);
  });
});
