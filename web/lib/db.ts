import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Candle, TF } from './types';

// ============================================================
// LƯU TRỮ SQLITE.
//
// Bốn thứ được lưu: nến, từng lần quét, từng tín hiệu, và kết quả backtest.
//
// VÌ SAO node:sqlite CHỨ KHÔNG PHẢI better-sqlite3: bản này phải chạy được ngay
// sau khi giải nén zip trên máy người dùng. better-sqlite3 cần biên dịch native
// lúc cài — hỏng trình biên dịch là hỏng cả sản phẩm. node:sqlite có sẵn trong
// Node 22, không cần cài gì.
//
// TRÊN SERVERLESS THÌ TẮT, VÀ NÓI RA. Vercel cho ghi mỗi /tmp và ổ đó biến mất
// theo instance, nên một file SQLite ở đó là ảo tưởng lưu trữ: ghi được, đọc lại
// được trong vài phút, rồi mất sạch mà không báo. Cùng lý do mà snapshot.ts đã
// tắt sẵn. Muốn lưu thật trên serverless thì trỏ MARKETSCAN_DB vào ổ gắn ngoài.
// ============================================================

type Row = Record<string, unknown>;
interface Stmt { run(...a: unknown[]): unknown; all(...a: unknown[]): Row[]; get(...a: unknown[]): Row | undefined }
interface DB { exec(sql: string): void; prepare(sql: string): Stmt; close(): void }

// Đọc env mỗi lần chứ không chốt lúc import: chốt lúc import thì đổi cấu hình
// phải khởi động lại tiến trình, và test phải giở trò nạp lại module để đổi được
// một biến — trò đó chính là chỗ trạng thái cũ rò từ test này sang test khác.
const onServerless = () => !!process.env.VERCEL && !process.env.MARKETSCAN_DB;
const dbPath = () => process.env.MARKETSCAN_DB ?? './data/marketscan.db';

const SERVERLESS_NOTE =
  'SQLite tắt trên serverless — đĩa ephemeral, ghi được nhưng mất theo instance. '
  + 'Chạy local, hoặc trỏ MARKETSCAN_DB vào ổ lưu trữ thật.';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Nến. Khoá chính (symbol, tf, t) nên ghi lại cùng một nến là idempotent —
-- quét nền chạy mỗi phút không được đẻ ra bản sao.
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL,
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
  v REAL NOT NULL, q REAL NOT NULL, taker_buy_base REAL,
  PRIMARY KEY (symbol, tf, t)
) WITHOUT ROWID;
-- Chỉ lưu nến ĐÃ ĐÓNG: nến đang chạy còn đổi, lưu nó là lưu một con số sẽ sai.

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, ict_time TEXT NOT NULL,
  duration_ms INTEGER NOT NULL, symbols INTEGER NOT NULL,
  trigger TEXT NOT NULL,              -- 'nen' | 'thu-cong' | 'cron'
  degraded TEXT NOT NULL              -- JSON: nguồn nào hỏng lúc quét
);
CREATE INDEX IF NOT EXISTS scans_ts ON scans(ts DESC);

-- Một dòng cho mỗi symbol × mỗi khung của mỗi lần quét. Đây là thứ để về sau
-- hỏi được "lúc đó hệ nói gì" mà không phải tin vào trí nhớ.
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
  side TEXT NOT NULL, conviction TEXT NOT NULL,
  golden INTEGER NOT NULL, tradeable INTEGER NOT NULL, unanimous INTEGER NOT NULL,
  net REAL NOT NULL, price REAL NOT NULL,
  entry_lo REAL, entry_hi REAL, sl REAL, tp1 REAL, tp2 REAL,
  rr1 REAL, rr2 REAL, reward_ratio REAL,
  expectancy_r REAL, p_win REAL,
  fresh_bar INTEGER NOT NULL,         -- nến của khung này đã đóng chưa
  gate_blockers TEXT NOT NULL,        -- JSON: đúng những gì đang chặn
  warnings TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_sym ON signals(symbol, tf, ts DESC);
CREATE INDEX IF NOT EXISTS signals_ts ON signals(ts DESC);

-- Kết quả backtest, kèm ĐỦ thứ để chạy lại: cấu hình, phạm vi thời gian, và dấu
-- kiểm tra dữ liệu. Một con số backtest không kèm ba thứ này là một con số không
-- kiểm chứng lại được, tức là một niềm tin.
CREATE TABLE IF NOT EXISTS backtests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, label TEXT NOT NULL,
  symbols TEXT NOT NULL, tfs TEXT NOT NULL, bars INTEGER NOT NULL,
  from_ts INTEGER NOT NULL, to_ts INTEGER NOT NULL,
  config TEXT NOT NULL,               -- JSON: BTOptions đầy đủ
  fingerprint TEXT NOT NULL,          -- sha256 của chính chuỗi nến đã dùng
  code_rev TEXT NOT NULL,             -- git rev lúc chạy
  intrabar TEXT NOT NULL,             -- 'gia-dinh' | 'nen-1m'
  stats TEXT NOT NULL                 -- JSON: BTStats
);
CREATE INDEX IF NOT EXISTS backtests_ts ON backtests(ts DESC);

CREATE TABLE IF NOT EXISTS backtest_trades (
  backtest_id INTEGER NOT NULL REFERENCES backtests(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, tf TEXT NOT NULL, side TEXT NOT NULL,
  conviction TEXT NOT NULL, signal_ts INTEGER NOT NULL,
  entry REAL NOT NULL, sl REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL NOT NULL,
  exit_reason TEXT NOT NULL, r REAL NOT NULL, r_gross REAL NOT NULL, cost_r REAL NOT NULL,
  hit_tp1 INTEGER NOT NULL, hit_tp2 INTEGER NOT NULL,
  tradeable INTEGER NOT NULL, expectancy_r REAL,
  intrabar_resolved INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bt_trades_id ON backtest_trades(backtest_id);
`;

let handle: DB | null = null;
let failed: string | null = null;

/**
 * Mở CSDL, tạo bảng nếu chưa có. Trả null khi không lưu được — người gọi phải xử
 * lý null chứ không được giả định là luôn có, vì trên serverless thì luôn null.
 */
export function db(): DB | null {
  if (onServerless() || failed) return null;
  if (handle) return handle;
  try {
    // require động: `node:sqlite` chưa có trong mọi bản Node, và bản web build
    // cho edge không được kéo nó vào bundle.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => DB };
    const p = resolve(process.cwd(), dbPath());
    mkdirSync(dirname(p), { recursive: true });
    const d = new DatabaseSync(p);
    d.exec(SCHEMA);
    handle = d;
    return d;
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
    return null;
  }
}

/** Vì sao không lưu được — để màn hình nói ra thay vì im lặng. */
export function dbNote(): string | null {
  if (onServerless()) return SERVERLESS_NOTE;
  return failed ? `SQLite không mở được: ${failed}` : null;
}

/** Đóng CSDL và quên cả lỗi cũ, để lần mở sau đọc lại cấu hình từ đầu. */
export function closeDb() {
  handle?.close();
  handle = null;
  failed = null;
}

// ---------------- nến ----------------

/** Ghi nến đã đóng. Nến chưa đóng bị BỎ, không phải bị ghi rồi sửa sau. */
export function saveCandles(symbol: string, tf: TF, candles: Candle[]): number {
  const d = db();
  if (!d) return 0;
  const st = d.prepare(
    `INSERT INTO candles (symbol, tf, t, o, h, l, c, v, q, taker_buy_base)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, tf, t) DO UPDATE SET
       o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c,
       v=excluded.v, q=excluded.q, taker_buy_base=excluded.taker_buy_base`,
  );
  let n = 0;
  d.exec('BEGIN');
  try {
    for (const c of candles) {
      if (!c.closed) continue;
      st.run(symbol, tf, c.t, c.o, c.h, c.l, c.c, c.v, c.q, c.takerBuyBase);
      n++;
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return n;
}

export function loadCandles(symbol: string, tf: TF, limit = 500): Candle[] {
  const d = db();
  if (!d) return [];
  const rows = d.prepare(
    'SELECT * FROM candles WHERE symbol = ? AND tf = ? ORDER BY t DESC LIMIT ?',
  ).all(symbol, tf, limit);
  return rows.reverse().map((r) => ({
    t: Number(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c),
    v: Number(r.v), q: Number(r.q),
    takerBuyBase: r.taker_buy_base == null ? null : Number(r.taker_buy_base),
    closed: true,
  }));
}

/**
 * Dấu kiểm tra dữ liệu: sha256 của chính chuỗi nến đã dùng.
 *
 * Có nó thì hai lần chạy cho số khác nhau là trả lời được ngay "vì dữ liệu khác"
 * hay "vì code khác" — không có nó thì mọi tranh cãi về backtest đều là đoán.
 */
export function fingerprint(candles: Candle[]): string {
  const h = createHash('sha256');
  for (const c of candles) h.update(`${c.t},${c.o},${c.h},${c.l},${c.c},${c.v}\n`);
  return h.digest('hex').slice(0, 16);
}

// ---------------- lần quét + tín hiệu ----------------

export interface SavedScan {
  ts: number;
  ictTime: string;
  durationMs: number;
  trigger: 'nen' | 'thu-cong' | 'cron';
  degraded: string[];
}

/**
 * Ghi một lần quét cùng mọi tín hiệu của nó, trong MỘT giao dịch.
 *
 * Một giao dịch vì hai bảng này chỉ có nghĩa khi đi cùng nhau: một lần quét
 * không có tín hiệu, hoặc tín hiệu mồ côi không biết thuộc lần quét nào, đều là
 * rác khi về sau muốn đối chiếu.
 */
export function saveScan(scan: SavedScan, rows: SignalRow[]): number | null {
  const d = db();
  if (!d) return null;
  d.exec('BEGIN');
  try {
    d.prepare(
      'INSERT INTO scans (ts, ict_time, duration_ms, symbols, trigger, degraded) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(scan.ts, scan.ictTime, scan.durationMs,
      new Set(rows.map((r) => r.symbol)).size, scan.trigger, JSON.stringify(scan.degraded));
    const id = Number((d.prepare('SELECT last_insert_rowid() AS id').get() as Row).id);

    const st = d.prepare(
      `INSERT INTO signals (
         scan_id, ts, symbol, tf, side, conviction, golden, tradeable, unanimous,
         net, price, entry_lo, entry_hi, sl, tp1, tp2, rr1, rr2, reward_ratio,
         expectancy_r, p_win, fresh_bar, gate_blockers, warnings
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      st.run(
        id, scan.ts, r.symbol, r.tf, r.side, r.conviction,
        r.golden ? 1 : 0, r.tradeable ? 1 : 0, r.unanimous ? 1 : 0,
        r.net, r.price, r.entryLo, r.entryHi, r.sl, r.tp1, r.tp2,
        r.rr1, r.rr2, r.rewardRatio, r.expectancyR, r.pWin,
        r.freshBar ? 1 : 0, JSON.stringify(r.gateBlockers), JSON.stringify(r.warnings),
      );
    }
    d.exec('COMMIT');
    return id;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export interface SignalRow {
  symbol: string; tf: TF; side: string; conviction: string;
  golden: boolean; tradeable: boolean; unanimous: boolean;
  net: number; price: number;
  entryLo: number | null; entryHi: number | null;
  sl: number | null; tp1: number | null; tp2: number | null;
  rr1: number | null; rr2: number | null; rewardRatio: number | null;
  expectancyR: number | null; pWin: number | null;
  /** Khung này đã có nến đóng của chu kỳ vừa xong chưa. */
  freshBar: boolean;
  gateBlockers: string[];
  warnings: string[];
}

export function recentScans(limit = 50): Row[] {
  return db()?.prepare('SELECT * FROM scans ORDER BY ts DESC LIMIT ?').all(limit) ?? [];
}

/** Lịch sử tín hiệu của một mã + khung — để nhìn hệ đã đổi ý lúc nào. */
export function signalHistory(symbol: string, tf: TF, limit = 200): Row[] {
  return db()?.prepare(
    'SELECT * FROM signals WHERE symbol = ? AND tf = ? ORDER BY ts DESC LIMIT ?',
  ).all(symbol, tf, limit) ?? [];
}

/** Toàn bộ tín hiệu của một lần quét. */
export function signalsOfScan(scanId: number): Row[] {
  return db()?.prepare('SELECT * FROM signals WHERE scan_id = ? ORDER BY symbol, tf').all(scanId) ?? [];
}

// ---------------- backtest ----------------

export interface SavedBacktest {
  label: string;
  symbols: string[];
  tfs: string[];
  bars: number;
  fromTs: number;
  toTs: number;
  config: unknown;
  fingerprint: string;
  codeRev: string;
  intrabar: 'gia-dinh' | 'nen-1m';
  stats: unknown;
}

export interface SavedTrade {
  symbol: string; tf: string; side: string; conviction: string; signalTime: number;
  entry: number; sl: number; tp1: number; tp2: number;
  exitReason: string; r: number; rGross: number; costR: number;
  hitTP1: boolean; hitTP2: boolean; tradeable: boolean;
  expectancyR: number | null; intrabarResolved: boolean;
}

export function saveBacktest(bt: SavedBacktest, trades: SavedTrade[]): number | null {
  const d = db();
  if (!d) return null;
  d.exec('BEGIN');
  try {
    d.prepare(
      `INSERT INTO backtests (ts, label, symbols, tfs, bars, from_ts, to_ts,
         config, fingerprint, code_rev, intrabar, stats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(Date.now(), bt.label, bt.symbols.join(','), bt.tfs.join(','), bt.bars,
      bt.fromTs, bt.toTs, JSON.stringify(bt.config), bt.fingerprint, bt.codeRev,
      bt.intrabar, JSON.stringify(bt.stats));
    const id = Number((d.prepare('SELECT last_insert_rowid() AS id').get() as Row).id);

    const st = d.prepare(
      `INSERT INTO backtest_trades (
         backtest_id, symbol, tf, side, conviction, signal_ts, entry, sl, tp1, tp2,
         exit_reason, r, r_gross, cost_r, hit_tp1, hit_tp2, tradeable, expectancy_r,
         intrabar_resolved
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of trades) {
      st.run(id, t.symbol, t.tf, t.side, t.conviction, t.signalTime,
        t.entry, t.sl, t.tp1, t.tp2, t.exitReason, t.r, t.rGross, t.costR,
        t.hitTP1 ? 1 : 0, t.hitTP2 ? 1 : 0, t.tradeable ? 1 : 0,
        t.expectancyR, t.intrabarResolved ? 1 : 0);
    }
    d.exec('COMMIT');
    return id;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function recentBacktests(limit = 30): Row[] {
  return db()?.prepare('SELECT * FROM backtests ORDER BY ts DESC LIMIT ?').all(limit) ?? [];
}
