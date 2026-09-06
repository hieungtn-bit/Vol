import { describe, expect, it } from 'vitest';
import { DEFAULT_BT, simulate, type BTOptions } from '@/lib/backtest';
import { minuteFeed, toMs, unzipFirst } from '@/lib/minute';
import { deflateRawSync } from 'node:zlib';
import type { DirectionalCall } from '@/lib/direct';
import type { Candle } from '@/lib/types';

const FREE: BTOptions = { ...DEFAULT_BT, feeRate: 0, slipRate: 0 };
const HOUR = 3_600_000;

const base = (over: Partial<DirectionalCall> = {}): DirectionalCall => ({
  symbol: 'T', tf: '1h', side: 'LONG', conviction: 'A', golden: false, goldenBlockers: [],
  net: 50, longScore: 75, shortScore: 25,
  unanimous: true, contestedBy: [], tradeable: true, gateBlockers: [],
  entry: [99, 100], sl: 98, tp1: 102, tp2: 106,
  rr1: 1, rr2: 3, rewardRatio: 2, expectancy: null, runner: null, size: 'Normal',
  trigger: '', invalidation: '', evidence: [], structureNote: '', flowNote: '',
  fundingText: '', buyPctPerp: null, buyPctSpot: null, warnings: [], planText: '',
  ...over,
});

const bar = (o: number, h: number, l: number, c: number, i = 0): Candle =>
  ({ t: i * HOUR, o, h, l, c, v: 100, q: 100 * c, takerBuyBase: 50, closed: true });

/**
 * Nến 1m: `path` là dãy giá đi qua trong giờ thứ `hour`, đệm cho đủ 60 phút bằng
 * giá cuối. Phải đủ 60 phút: feed CỐ Ý từ chối phủ một phần, vì phủ một phần thì
 * đoạn thiếu sẽ lặng lẽ thành "không có gì xảy ra".
 */
function minutes(hour: number, path: number[]): Candle[] {
  const full = [...path, ...Array(Math.max(0, 60 - path.length)).fill(path[path.length - 1])];
  // Mỗi phút phủ trọn đoạn từ giá phút trước tới giá phút này. Giá đi liên tục,
  // không nhảy cóc qua mức — nến điểm rời rạc sẽ dựng ra những cú nhảy không có
  // thật và làm test kiểm tra sai thứ.
  return full.map((p, i) => {
    const prev = i === 0 ? p : full[i - 1];
    return {
      t: hour * HOUR + i * 60_000, o: prev, h: Math.max(prev, p), l: Math.min(prev, p), c: p,
      v: 1, q: p, takerBuyBase: 0.5, closed: true,
    };
  });
}

describe('nến 1m gỡ thứ tự chạm trong nến', () => {
  // Cùng MỘT cây nến 1h: chạm entry 100, xuống 97 (dưới SL 98), lên 107 (trên TP2).
  // Nến 1h không nói được thứ tự. Nến 1m thì có.
  const h1 = bar(101, 107, 97, 103, 1);
  const cs = [bar(101, 101, 101, 101, 0), h1, bar(103, 103, 103, 103, 2)];

  it('không có nến 1m → giả định thận trọng, tính SL, −1R', () => {
    const t = simulate(cs, 0, base(), FREE)!;
    expect(t.exitReason).toBe('sl');
    expect(t.r).toBe(-1);
    expect(t.intrabarResolved).toBe(false);
  });

  it('nến 1m nói giá LÊN TRƯỚC → ăn TP2 thật, không phải −1R giả định', () => {
    const path = [101, 100, 103, 105, 107, 103, 99, 97];   // chạm entry → lên TP2 → mới xuống
    const t = simulate(cs, 0, base(), FREE, { minutes: minuteFeed(minutes(1, path)), tfMs: HOUR })!;
    expect(t.intrabarResolved).toBe(true);
    expect(t.exitReason).toBe('tp2');
    expect(t.r).toBeCloseTo(0.5 * 1 + 0.5 * 3, 6);
  });

  it('nến 1m nói giá XUỐNG TRƯỚC → vẫn là −1R, và giờ là số đo chứ không phải giả định', () => {
    const path = [101, 100, 99, 97, 103, 107];   // chạm entry → thủng SL → mới lên
    const t = simulate(cs, 0, base(), FREE, { minutes: minuteFeed(minutes(1, path)), tfMs: HOUR })!;
    expect(t.intrabarResolved).toBe(true);
    expect(t.exitReason).toBe('sl');
    expect(t.r).toBe(-1);
  });

  it('lãi TRƯỚC lúc khớp lệnh không được tính — lúc đó chưa có lệnh nào để lãi', () => {
    // Giá vọt lên 107 (qua cả TP2) rồi mới quay xuống 100 để khớp, rồi thủng 97.
    // Cú lên 107 xảy ra khi chưa có lệnh, nên kết quả phải là SL chứ không phải TP2.
    const path = [101, 105, 107, 103, 100, 99, 97];
    const t = simulate(cs, 0, base(), FREE, { minutes: minuteFeed(minutes(1, path)), tfMs: HOUR })!;
    expect(t.entryIdx).toBe(1);
    expect(t.hitTP2).toBe(false);
    expect(t.exitReason).toBe('sl');
  });

  it('trong CHÍNH phút khớp lệnh vẫn chọn phía xấu — quy tắc không đổi, chỉ nhỏ hơn 60 lần', () => {
    // Một phút duy nhất quét từ 97 lên 107 và có chứa 100 → không biết thứ tự
    // trong phút đó, nên tính SL.
    const m: Candle[] = [
      { t: HOUR, o: 100, h: 107, l: 97, c: 103, v: 1, q: 100, takerBuyBase: 0.5, closed: true },
      ...minutes(1, [103]).slice(1),
    ];
    const t = simulate(cs, 0, base(), FREE, { minutes: minuteFeed(m), tfMs: HOUR })!;
    expect(t.exitReason).toBe('sl');
  });

  it('feed trả null (ngoài phạm vi dữ liệu) → quay về giả định, KHÔNG coi là "không có gì xảy ra"', () => {
    const far = minuteFeed(minutes(500, [100, 101]));
    const t = simulate(cs, 0, base(), FREE, { minutes: far, tfMs: HOUR })!;
    expect(t.intrabarResolved).toBe(false);
    expect(t.exitReason).toBe('sl');
  });

  it('short đối xứng', () => {
    const s = base({ side: 'SHORT', entry: [100, 101], sl: 102, tp1: 98, tp2: 94 });
    const csS = [bar(99, 99, 99, 99, 0), bar(99, 103, 93, 97, 1), bar(97, 97, 97, 97, 2)];
    const len = simulate(csS, 0, s, FREE, { minutes: minuteFeed(minutes(1, [99, 100, 97, 94, 93, 103])), tfMs: HOUR })!;
    expect(len.exitReason).toBe('tp2');
    const thua = simulate(csS, 0, s, FREE, { minutes: minuteFeed(minutes(1, [99, 100, 103, 94])), tfMs: HOUR })!;
    expect(thua.exitReason).toBe('sl');
  });
});

describe('đọc kho lưu trữ Binance', () => {
  it('mốc thời gian micro giây được đưa về mili giây', () => {
    expect(toMs(1782864000000000)).toBe(1782864000000);
    expect(toMs(1782864000000)).toBe(1782864000000);
    expect(toMs(1782864000000000000)).toBe(1782864000000);
  });

  it('đọc được ZIP nén DEFLATE mà không cần thư viện ngoài', () => {
    const body = 'a,b,c\n1,2,3\n';
    const raw = deflateRawSync(Buffer.from(body));
    const name = Buffer.from('x.csv');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(8, 8);              // deflate
    head.writeUInt32LE(raw.length, 18);
    head.writeUInt32LE(body.length, 22);
    head.writeUInt16LE(name.length, 26);
    expect(unzipFirst(Buffer.concat([head, name, raw]))).toBe(body);
  });

  it('không phải ZIP thì báo lỗi chứ không trả rỗng', () => {
    expect(() => unzipFirst(Buffer.from('không phải zip đâu'))).toThrow();
  });
});
