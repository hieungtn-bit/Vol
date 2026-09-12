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
    const i = co({
      last: 0.15400, rr: 0.49,
      // Cụm 1H 20:00+21:00 — SL 0.15254 nằm GIỮA cụm, đúng túi stop.
      cum1h: { low: 0.1505, high: 0.1566, bars: [T2000, T2100] },
      openK: bar(0.1540, 0.15764, 0.13980, 0.1540, 7.3e8, false),
      lastClosedK: bar(0.1500, 0.1560, 0.1500, 0.1540, 2.0e8, true),
    });
    const v = evaluate(i);
    idT0 = v.id;
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
    const a = co({
      last: 0.15400, rr: 0.49,
      cum1h: { low: 0.1505, high: 0.1566, bars: [T2000, T2100] },
      openK: bar(0.1540, 0.15764, 0.1398, 0.1540, 7.3e8, false),
    });
    const v0 = evaluate(a);
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
    expect(log.length).toBeGreaterThanOrEqual(13);
  });
});
