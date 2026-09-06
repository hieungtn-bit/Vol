import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';
async function fresh() {
  const db = await import('@/lib/db');
  const sc = await import('@/lib/scanner');
  sc.stopScanner();
  db.closeDb();
  dir = mkdtempSync(join(tmpdir(), 'ms-sc-'));
  process.env.MARKETSCAN_DB = join(dir, 'test.db');
  delete process.env.VERCEL;
  delete process.env.MARKETSCAN_BACKGROUND;
  return { db, sc };
}

afterEach(async () => {
  (await import('@/lib/scanner')).stopScanner();
  (await import('@/lib/db')).closeDb();
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = ''; }
  delete process.env.MARKETSCAN_DB;
  delete process.env.VERCEL;
  delete process.env.MARKETSCAN_BACKGROUND;
  vi.useRealTimers();
});

describe('quét nền', () => {
  it('bật được khi có CSDL, và hẹn lượt kế tiếp', async () => {
    const { sc } = await fresh();
    const s = sc.startScanner(['ENAUSDT']);
    expect(s.running).toBe(true);
    expect(s.why).toBeNull();
    expect(s.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('KHÔNG bật khi không lưu được — quét mà vứt kết quả là đốt rate limit', async () => {
    const { sc, db } = await fresh();
    db.closeDb();
    process.env.VERCEL = '1';
    delete process.env.MARKETSCAN_DB;
    const s = sc.startScanner(['ENAUSDT']);
    expect(s.running).toBe(false);
    expect(s.why).toMatch(/ephemeral/);
  });

  it('tắt được bằng biến môi trường, và nói rõ là do biến đó', async () => {
    const { sc } = await fresh();
    process.env.MARKETSCAN_BACKGROUND = '0';
    const s = sc.startScanner(['ENAUSDT']);
    expect(s.running).toBe(false);
    expect(s.why).toMatch(/MARKETSCAN_BACKGROUND/);
  });

  it('bật hai lần không đẻ ra hai vòng lặp', async () => {
    const { sc } = await fresh();
    const a = sc.startScanner(['ENAUSDT']);
    const b = sc.startScanner(['BTCUSDT', 'ETHUSDT']);
    expect(b.running).toBe(true);
    // lần hai không được ghi đè danh sách mã của vòng đang chạy
    expect(b.symbols).toEqual(a.symbols);
    expect(b.nextRunAt).toBe(a.nextRunAt);
  });

  it('lượt kế tiếp rơi đúng mốc đóng nến 15m, không phải "60 giây một lần"', async () => {
    const { sc } = await fresh();
    // 10:07:30 → nến 15m kế tiếp đóng lúc 10:15:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T10:07:30Z'));
    const s = sc.startScanner(['ENAUSDT']);
    const next = new Date(s.nextRunAt!);
    expect(next.getUTCMinutes()).toBe(15);
    expect(next.getUTCSeconds()).toBe(8);   // + thời gian chờ sàn chốt nến
  });

  it('dừng rồi thì không còn lượt nào được hẹn', async () => {
    const { sc } = await fresh();
    sc.startScanner(['ENAUSDT']);
    sc.stopScanner();
    const s = sc.scannerState();
    expect(s.running).toBe(false);
    expect(s.nextRunAt).toBeNull();
  });
});
