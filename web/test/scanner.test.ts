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

describe('sức khoẻ đọc từ CSDL, không đọc từ biến trong bộ nhớ', () => {
  // Next chạy instrumentation.ts và route handler ở TIẾN TRÌNH KHÁC NHAU, nên
  // không singleton nào trong bộ nhớ bắc cầu được — kể cả globalThis (đã thử,
  // vẫn sai). Thứ duy nhất hai tiến trình cùng thấy là CSDL.

  it('chưa có lượt nào được ghi → quá hạn, dù bộ hẹn giờ đang chạy', async () => {
    const { sc } = await fresh();
    sc.startScanner(['ENAUSDT']);
    const h = sc.scannerHealth();
    expect(h.local.running).toBe(true);   // biến trong tiến trình NÀY nói là bật
    expect(h.lastScan).toBeNull();        // nhưng chưa lượt nào thật sự chạy
    expect(h.stale).toBe(true);           // nên câu trả lời phải là quá hạn
  });

  it('lượt vừa ghi xong → không quá hạn, và đọc được dù bộ hẹn giờ ở tiến trình khác', async () => {
    const { sc, db } = await fresh();
    // KHÔNG gọi startScanner: giả lập đúng tiến trình chỉ phục vụ route handler.
    db.saveScan(
      { ts: Date.now(), ictTime: '18:00', durationMs: 900, trigger: 'nen', degraded: [] },
      [],
    );
    const h = sc.scannerHealth();
    expect(h.local.running).toBe(false);
    expect(h.stale).toBe(false);
    expect(h.lastScan?.trigger).toBe('nen');
    expect(h.lastScan?.durationMs).toBe(900);
  });

  it('lượt cuối quá hai chu kỳ nến 15m → quá hạn', async () => {
    const { sc, db } = await fresh();
    db.saveScan(
      { ts: Date.now() - 31 * 60_000, ictTime: 'cũ', durationMs: 900, trigger: 'nen', degraded: [] },
      [],
    );
    expect(sc.scannerHealth().stale).toBe(true);
  });

  it('không lưu được → nói ra ở trường db, và không giả vờ có lượt quét', async () => {
    const { sc, db } = await fresh();
    db.closeDb();
    process.env.VERCEL = '1';
    delete process.env.MARKETSCAN_DB;
    const h = sc.scannerHealth();
    expect(h.db).toMatch(/ephemeral/);
    expect(h.lastScan).toBeNull();
    expect(h.stale).toBe(true);
  });
});
