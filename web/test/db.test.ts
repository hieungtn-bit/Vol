import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Mỗi test một file CSDL riêng — test dùng chung state là test nói dối. */
let dir = '';
async function fresh() {
  const db = await import('@/lib/db');
  db.closeDb();
  dir = mkdtempSync(join(tmpdir(), 'ms-db-'));
  process.env.MARKETSCAN_DB = join(dir, 'test.db');
  delete process.env.VERCEL;
  return db;
}

afterEach(async () => {
  (await import('@/lib/db')).closeDb();
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = ''; }
  delete process.env.MARKETSCAN_DB;
  delete process.env.VERCEL;
});

describe('lưu nến', () => {
  const c = (t: number, close: number, closed = true) =>
    ({ t, o: close, h: close + 1, l: close - 1, c: close, v: 10, q: 10 * close, takerBuyBase: 5, closed });

  it('ghi rồi đọc lại đúng, theo thứ tự thời gian tăng dần', async () => {
    const db = await fresh();
    expect(db.saveCandles('BTCUSDT', '1h', [c(3000, 30), c(1000, 10), c(2000, 20)])).toBe(3);
    const back = db.loadCandles('BTCUSDT', '1h');
    expect(back.map((x) => x.t)).toEqual([1000, 2000, 3000]);
    expect(back[1].c).toBe(20);
    db.closeDb();
  });

  it('nến CHƯA ĐÓNG không được lưu — nó còn đổi', async () => {
    const db = await fresh();
    expect(db.saveCandles('BTCUSDT', '1h', [c(1000, 10), c(2000, 20, false)])).toBe(1);
    expect(db.loadCandles('BTCUSDT', '1h')).toHaveLength(1);
    db.closeDb();
  });

  it('ghi lại cùng một nến là idempotent, không đẻ bản sao', async () => {
    const db = await fresh();
    db.saveCandles('BTCUSDT', '1h', [c(1000, 10)]);
    db.saveCandles('BTCUSDT', '1h', [c(1000, 10), c(1000, 10)]);
    expect(db.loadCandles('BTCUSDT', '1h')).toHaveLength(1);
    db.closeDb();
  });

  it('nến sửa lại (sàn ghi đè) thì cập nhật chứ không nhân đôi', async () => {
    const db = await fresh();
    db.saveCandles('BTCUSDT', '1h', [c(1000, 10)]);
    db.saveCandles('BTCUSDT', '1h', [c(1000, 99)]);
    const back = db.loadCandles('BTCUSDT', '1h');
    expect(back).toHaveLength(1);
    expect(back[0].c).toBe(99);
    db.closeDb();
  });

  it('mã và khung khác nhau không đụng nhau', async () => {
    const db = await fresh();
    db.saveCandles('BTCUSDT', '1h', [c(1000, 10)]);
    db.saveCandles('BTCUSDT', '4h', [c(1000, 20)]);
    db.saveCandles('ETHUSDT', '1h', [c(1000, 30)]);
    expect(db.loadCandles('BTCUSDT', '1h')[0].c).toBe(10);
    expect(db.loadCandles('BTCUSDT', '4h')[0].c).toBe(20);
    expect(db.loadCandles('ETHUSDT', '1h')[0].c).toBe(30);
    db.closeDb();
  });
});

describe('lưu lần quét và tín hiệu', () => {
  const sig = (over: Partial<import('@/lib/db').SignalRow> = {}): import('@/lib/db').SignalRow => ({
    symbol: 'ENAUSDT', tf: '1h', side: 'LONG', conviction: 'B',
    golden: false, tradeable: true, unanimous: true,
    net: 22, price: 0.08,
    entryLo: 0.079, entryHi: 0.08, sl: 0.077, tp1: 0.083, tp2: 0.087,
    rr1: 1.0, rr2: 2.3, rewardRatio: 1.65, expectancyR: 0.04, pWin: 0.44,
    freshBar: true, gateBlockers: [], warnings: [],
    ...over,
  });

  it('lần quét và tín hiệu của nó đi cùng nhau', async () => {
    const db = await fresh();
    const id = db.saveScan(
      { ts: 1000, ictTime: '08:00', durationMs: 1234, trigger: 'nen', degraded: [] },
      [sig(), sig({ tf: '4h', side: 'SHORT' })],
    )!;
    expect(id).toBeGreaterThan(0);
    expect(db.signalsOfScan(id)).toHaveLength(2);
    expect(db.recentScans()[0].symbols).toBe(1);   // hai khung nhưng một mã
    db.closeDb();
  });

  it('lý do bị chặn được lưu nguyên văn — về sau còn hỏi được vì sao trượt cửa', async () => {
    const db = await fresh();
    const id = db.saveScan(
      { ts: 1000, ictTime: '08:00', durationMs: 1, trigger: 'thu-cong', degraded: ['fapi 451'] },
      [sig({ tradeable: false, freshBar: false, gateBlockers: ['chưa có nến 1h đóng — dữ liệu cũ'] })],
    )!;
    const r = db.signalsOfScan(id)[0];
    expect(r.tradeable).toBe(0);
    expect(r.fresh_bar).toBe(0);
    expect(JSON.parse(String(r.gate_blockers))[0]).toContain('dữ liệu cũ');
    expect(JSON.parse(String(db.recentScans()[0].degraded))[0]).toBe('fapi 451');
    db.closeDb();
  });

  it('lịch sử tín hiệu trả về mới nhất trước', async () => {
    const db = await fresh();
    db.saveScan({ ts: 1000, ictTime: 'a', durationMs: 1, trigger: 'nen', degraded: [] }, [sig({ side: 'LONG' })]);
    db.saveScan({ ts: 2000, ictTime: 'b', durationMs: 1, trigger: 'nen', degraded: [] }, [sig({ side: 'SHORT' })]);
    const h = db.signalHistory('ENAUSDT', '1h');
    expect(h.map((r) => r.side)).toEqual(['SHORT', 'LONG']);
    db.closeDb();
  });
});

describe('lưu backtest kèm đủ thứ để chạy lại', () => {
  it('cấu hình, phạm vi thời gian, dấu kiểm tra dữ liệu và git rev đều được lưu', async () => {
    const db = await fresh();
    const id = db.saveBacktest({
      label: 'thử', symbols: ['ENAUSDT'], tfs: ['1h'], bars: 3000,
      fromTs: 1000, toTs: 2000, config: { feeRate: 0.0005 },
      fingerprint: 'abc123', codeRev: 'deadbeef', intrabar: 'nen-1m',
      stats: { trades: 1, avgR: 0.1 },
    }, [{
      symbol: 'ENAUSDT', tf: '1h', side: 'LONG', conviction: 'A', signalTime: 1500,
      entry: 0.08, sl: 0.077, tp1: 0.083, tp2: 0.087,
      exitReason: 'tp2', r: 1.4, rGross: 1.5, costR: 0.1,
      hitTP1: true, hitTP2: true, tradeable: true, expectancyR: 0.05, intrabarResolved: true,
    }])!;
    const b = db.recentBacktests()[0];
    expect(b.id).toBe(id);
    expect(b.fingerprint).toBe('abc123');
    expect(b.code_rev).toBe('deadbeef');
    expect(b.intrabar).toBe('nen-1m');
    expect(JSON.parse(String(b.config)).feeRate).toBe(0.0005);
    db.closeDb();
  });

  it('dấu kiểm tra dữ liệu đổi khi dữ liệu đổi, giữ nguyên khi không đổi', async () => {
    const db = await fresh();
    const a = [{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 5, q: 5, takerBuyBase: 2, closed: true }];
    const b = [{ t: 1, o: 1, h: 2, l: 0, c: 1.0001, v: 5, q: 5, takerBuyBase: 2, closed: true }];
    expect(db.fingerprint(a)).toBe(db.fingerprint([...a]));
    expect(db.fingerprint(a)).not.toBe(db.fingerprint(b));
    db.closeDb();
  });
});

describe('không lưu được thì phải NÓI RA, không im lặng', () => {
  it('trên serverless thì tắt, và dbNote() nói rõ vì sao', async () => {
    const db = await import('@/lib/db');
    db.closeDb();
    process.env.VERCEL = '1';
    delete process.env.MARKETSCAN_DB;
    expect(db.db()).toBeNull();
    expect(db.dbNote()).toMatch(/ephemeral/);
    // và mọi hàm ghi phải trả về giá trị rỗng chứ không nổ
    expect(db.saveCandles('BTCUSDT', '1h', [])).toBe(0);
    expect(db.recentScans()).toEqual([]);
  });
});
