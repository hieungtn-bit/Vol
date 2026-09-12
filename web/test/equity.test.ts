import { describe, expect, it } from 'vitest';
import { runEquity } from '@/lib/equity';
import type { Trade } from '@/lib/backtest';

const H = 3_600_000;
let seq = 0;
/** Lệnh tối giản: chỉ những trường mà runEquity đọc tới. */
function t(r: number, hoursApart = 24): Trade {
  seq += 1;
  return {
    symbol: 'T', tf: '1h', side: 'LONG', conviction: 'B', golden: false, net: 20,
    signalIdx: 0, signalTime: seq * hoursApart * H,
    entryIdx: 0, entry: 100, sl: 98, tp1: 102, tp2: 106,
    exitIdx: 2, exitReason: r > 0 ? 'tp2' : 'sl', hitTP1: r > 0, hitTP2: r > 0,
    r, rGross: r, costR: 0, evidence: [], warningCount: 0,
    rrBlended: 1.4, rr1: 1, rr2: 3, rewardR: 2,
    slPct: 2, entryDistPct: 0, unanimous: true, tradeable: true,
  } as Trade;
}
const reset = () => { seq = 0; };

describe('rủi ro cố định theo % vốn — đặt bằng nhau theo TỈ LỆ, không theo tiền', () => {
  it('thắng 1R với rủi ro 1% thì vốn tăng đúng 1%', () => {
    reset();
    const e = runEquity([t(1)], { equity: 1000, riskPct: 1, maxConcurrent: 10 });
    expect(e.end).toBeCloseTo(1010, 9);
  });

  it('sau khi lãi, số tiền rủi ro lần sau LỚN HƠN — nên hai lệnh 1R không phải +2%', () => {
    reset();
    const e = runEquity([t(1), t(1)], { equity: 1000, riskPct: 1, maxConcurrent: 10 });
    expect(e.end).toBeCloseTo(1000 * 1.01 * 1.01, 6);
    expect(e.end).toBeGreaterThan(1020);
  });

  it('thua thì số tiền rủi ro lần sau NHỎ HƠN — đó là cái giữ tài khoản sống', () => {
    reset();
    const e = runEquity(Array.from({ length: 50 }, () => t(-1)), { equity: 1000, riskPct: 1, maxConcurrent: 10 });
    // 50 lệnh thua liên tiếp mà vẫn còn tiền, vì mỗi lần chỉ mất 1% của phần còn lại
    expect(e.end).toBeCloseTo(1000 * 0.99 ** 50, 6);
    expect(e.end).toBeGreaterThan(600);
    expect(e.longestLossStreak).toBe(50);
  });
});

describe('sụt giảm và chuỗi thua — thứ quyết định người ta đi hết đường hay bỏ', () => {
  it('sụt giảm tính theo % ĐỈNH, không theo vốn ban đầu', () => {
    reset();
    // lên 20% rồi mất 3 lệnh
    const e = runEquity([t(20), t(-1), t(-1), t(-1)], { equity: 1000, riskPct: 1, maxConcurrent: 10 });
    expect(e.maxDrawdownPct).toBeGreaterThan(0);
    expect(e.maxDrawdownPct).toBeLessThan(5);
    expect(e.troughEquity).toBeLessThan(1200);
  });

  it('chuỗi thua dài nhất đếm đúng, kể cả khi bị cắt quãng', () => {
    reset();
    const e = runEquity([t(-1), t(-1), t(1), t(-1), t(-1), t(-1), t(1)], { equity: 1000, riskPct: 1, maxConcurrent: 10 });
    expect(e.longestLossStreak).toBe(3);
  });

  it('quãng CHÌM tính bằng ngày, và tính cả quãng chưa lấy lại được đỉnh', () => {
    reset();
    // lên đỉnh rồi thua liên tục tới hết mẫu → chìm suốt phần còn lại
    const e = runEquity([t(1), t(-1), t(-1), t(-1)], { equity: 1000, riskPct: 1, maxConcurrent: 10 });
    expect(e.longestUnderwaterDays).toBeCloseTo(3, 0);   // 3 lệnh × 24h
  });

  it('hệ hoà vốn về R vẫn có thể sụt sâu — thứ tự lệnh quyết định', () => {
    reset();
    const xau = runEquity([...Array.from({ length: 10 }, () => t(-1)), ...Array.from({ length: 10 }, () => t(1))],
      { equity: 1000, riskPct: 5, maxConcurrent: 10 });
    expect(xau.maxDrawdownPct).toBeGreaterThan(35);
  });
});

describe('trần số lệnh mở cùng lúc', () => {
  it('kèo tới lúc đã kín chỗ thì BỎ, không vào thêm', () => {
    reset();
    // ba lệnh cùng giờ, trần 2 → lệnh thứ ba bị bỏ
    const cung = [t(1, 0), t(1, 0), t(1, 0)].map((x) => ({ ...x, signalTime: 1000 }));
    const e = runEquity(cung as Trade[], { equity: 1000, riskPct: 1, maxConcurrent: 2 });
    expect(e.trades).toBe(2);
    expect(e.skippedFull).toBe(1);
  });

  it('trần rộng hơn thì vào được nhiều hơn', () => {
    reset();
    const cung = [t(1, 0), t(1, 0), t(1, 0)].map((x) => ({ ...x, signalTime: 1000 }));
    expect(runEquity(cung as Trade[], { equity: 1000, riskPct: 1, maxConcurrent: 5 }).trades).toBe(3);
  });
});

describe('mẫu rỗng không làm nổ hàm', () => {
  it('không có lệnh nào', () => {
    const e = runEquity([], { equity: 1000, riskPct: 1, maxConcurrent: 3 });
    expect(e.end).toBe(1000);
    expect(e.returnPct).toBe(0);
    expect(e.maxDrawdownPct).toBe(0);
    expect(e.days).toBe(0);
  });
});
