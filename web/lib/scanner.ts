import { ALWAYS_INCLUDE } from '@/config/universe';
import { db, dbNote, recentScans, saveCandles, saveScan, type SignalRow } from './db';
import { ictString } from './format';
import { scanSymbol } from './scan';
import { TF_MS } from './sources';
import type { DirectionalCall } from './direct';
import type { TF } from './types';

// ============================================================
// QUÉT NỀN — chạy tiếp khi đã đóng tab trình duyệt.
//
// Trước đây mọi lần quét đều do trình duyệt kích: đóng tab là hệ ngừng nhìn thị
// trường, và lịch sử tín hiệu có lỗ thủng đúng những lúc không ai ngồi xem. Bộ
// này chạy trong tiến trình server, độc lập với trình duyệt.
//
// QUÉT THEO NẾN ĐÓNG, KHÔNG QUÉT THEO ĐỒNG HỒ. Mỗi lần quét khi nến 15m vừa
// đóng, cộng vài giây trễ cho sàn kịp chốt. Quét dày hơn không đẻ ra thông tin
// mới — mọi đầu vào của engine đều lấy từ nến đã đóng — mà chỉ đốt rate limit và
// đẻ ra hàng đống dòng giống hệt nhau trong CSDL.
//
// CHỈ CHẠY KHI CÓ TIẾN TRÌNH SỐNG LÂU. Trên serverless mỗi request là một
// instance rồi chết, nên setInterval ở đó là một lời hứa suông: nó sẽ không bao
// giờ bắn lần thứ hai. Ở đó phải dùng cron thật (vercel.json) — và cron gói
// Hobby chỉ 1 lần/ngày, nên phải nói thẳng ra chứ không để người dùng tưởng.
// ============================================================

const TICK_TF: TF = '15m';
/** Trễ sau khi nến đóng, cho sàn kịp chốt nến cuối. */
const SETTLE_MS = 8_000;

export interface ScannerState {
  running: boolean;
  /** Vì sao không chạy. null nghĩa là đang chạy bình thường. */
  why: string | null;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: number | null;
  runs: number;
  symbols: string[];
}

const state: ScannerState = {
  running: false, why: null, lastRunAt: null, lastDurationMs: null,
  lastError: null, nextRunAt: null, runs: 0, symbols: [],
};

let timer: ReturnType<typeof setTimeout> | null = null;

export function scannerState(): ScannerState {
  return { ...state };
}

/** Mốc đóng nến 15m kế tiếp, cộng thời gian chờ sàn chốt. */
function nextTick(now = Date.now()): number {
  const step = TF_MS[TICK_TF];
  return Math.ceil((now + 1) / step) * step + SETTLE_MS;
}

/**
 * Một lượt quét. Không ném lỗi ra ngoài: một lượt hỏng không được giết vòng lặp,
 * nhưng PHẢI để lại dấu trong state để màn hình nói được là nó đang hỏng.
 */
export async function runOnce(trigger: 'nen' | 'thu-cong' | 'cron' = 'nen'): Promise<number | null> {
  const t0 = Date.now();
  const rows: SignalRow[] = [];
  const degraded: string[] = [];

  for (const symbol of state.symbols) {
    try {
      const scan = await scanSymbol(symbol);
      for (const e of scan.errors) degraded.push(`${symbol}: ${e}`);

      const dirs = scan.direction as Record<TF, DirectionalCall | null>;
      for (const tf of ['15m', '1h', '4h', '1d'] as TF[]) {
        const c = dirs[tf];
        if (!c) continue;
        rows.push({
          symbol, tf, side: c.side, conviction: c.conviction,
          golden: c.golden, tradeable: c.tradeable, unanimous: c.unanimous,
          net: c.net, price: scan.price,
          entryLo: c.entry[0], entryHi: c.entry[1], sl: c.sl, tp1: c.tp1, tp2: c.tp2,
          rr1: c.rr1, rr2: c.rr2, rewardRatio: c.rewardRatio,
          expectancyR: c.expectancy?.net ?? null, pWin: c.expectancy?.pWin ?? null,
          // Lý do bị chặn nói "chưa có nến … đóng" thì đúng khung đó đang dùng dữ
          // liệu cũ. Lưu thành cột riêng để về sau lọc được mà không phải dò chuỗi.
          freshBar: !c.gateBlockers.some((b) => b.includes('dữ liệu cũ')),
          gateBlockers: c.gateBlockers, warnings: c.warnings,
        });
      }
    } catch (e) {
      degraded.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  state.lastRunAt = t0;
  state.lastDurationMs = Date.now() - t0;
  state.runs++;
  state.lastError = rows.length === 0 ? 'không quét được mã nào' : null;

  try {
    return saveScan(
      { ts: t0, ictTime: ictString(), durationMs: state.lastDurationMs, trigger, degraded },
      rows,
    );
  } catch (e) {
    state.lastError = `lưu thất bại: ${e instanceof Error ? e.message : String(e)}`;
    return null;
  }
}

function schedule() {
  if (!state.running) return;
  const at = nextTick();
  state.nextRunAt = at;
  timer = setTimeout(() => {
    void runOnce('nen').finally(schedule);
  }, Math.max(1000, at - Date.now()));
  // Đừng giữ tiến trình sống chỉ vì cái hẹn giờ này — Ctrl-C phải thoát được ngay.
  timer.unref?.();
}

export function startScanner(symbols: string[] = ALWAYS_INCLUDE): ScannerState {
  if (state.running) return scannerState();

  if (process.env.MARKETSCAN_BACKGROUND === '0') {
    state.why = 'tắt bằng MARKETSCAN_BACKGROUND=0';
    return scannerState();
  }
  if (!db()) {
    // Quét nền mà không lưu được thì là đốt rate limit để lấy kết quả rồi vứt đi.
    state.why = dbNote() ?? 'không mở được CSDL';
    return scannerState();
  }

  state.symbols = symbols.slice(0, 20);
  state.running = true;
  state.why = null;
  schedule();
  return scannerState();
}

export function stopScanner() {
  state.running = false;
  state.nextRunAt = null;
  if (timer) { clearTimeout(timer); timer = null; }
}

/** Ghi nến vào CSDL — gọi từ đường quét để nến tích lại dần thay vì tải lại mãi. */
export function persistCandles(symbol: string, byTf: Partial<Record<TF, { t: number; o: number; h: number; l: number; c: number; v: number; q: number; takerBuyBase: number | null; closed: boolean }[]>>) {
  for (const [tf, cs] of Object.entries(byTf)) {
    if (cs?.length) saveCandles(symbol, tf as TF, cs);
  }
}

// ------------------------------------------------------------
// SỨC KHOẺ BỘ QUÉT — đọc từ CSDL, không đọc từ biến trong bộ nhớ.
//
// Đây là chỗ đã vấp một lần và đáng ghi lại. Ban đầu /api/scanner trả thẳng
// `scannerState()`, và log server ghi "quét nền: bật · 4 mã" trong khi API trả
// `running: false` — sai lặng lẽ, đúng loại sai mà thanh trạng thái sinh ra để
// bắt. Sửa lần một: đưa state lên globalThis. Vẫn sai. Lý do thật: Next chạy
// instrumentation.ts và route handler ở TIẾN TRÌNH KHÁC NHAU, nên không có
// singleton trong bộ nhớ nào bắc cầu được — kể cả globalThis.
//
// Thứ duy nhất hai tiến trình cùng nhìn thấy là CSDL. Và đọc từ đó còn đúng hơn
// về mặt ý nghĩa: nó trả lời "có lượt quét nào thật sự xảy ra gần đây không",
// chứ không phải "có biến nào đang được đặt là true không". Một bộ hẹn giờ còn
// sống mà mọi lượt đều ném lỗi thì `running: true` là câu trả lời sai.
// ------------------------------------------------------------

export interface ScannerHealth {
  /** Lượt quét gần nhất đã ghi được — sự thật dùng chung giữa các tiến trình. */
  lastScan: {
    id: number; ts: number; ictTime: string; trigger: string;
    durationMs: number; symbols: number; degraded: string[];
  } | null;
  /** Quá hạn: lượt gần nhất cách đây hơn hai chu kỳ nến. */
  stale: boolean;
  /** Trạng thái trong CHÍNH tiến trình này. Có thể rỗng dù bộ quét vẫn đang chạy ở tiến trình khác. */
  local: ScannerState;
  db: string | null;
}

export function scannerHealth(): ScannerHealth {
  const note = dbNote();
  let lastScan: ScannerHealth['lastScan'] = null;
  if (!note) {
    const r = recentScans(1)[0];
    if (r) {
      lastScan = {
        id: Number(r.id), ts: Number(r.ts), ictTime: String(r.ict_time),
        trigger: String(r.trigger), durationMs: Number(r.duration_ms),
        symbols: Number(r.symbols),
        degraded: JSON.parse(String(r.degraded) || '[]') as string[],
      };
    }
  }
  return {
    lastScan,
    stale: lastScan == null || Date.now() - lastScan.ts > TF_MS[TICK_TF] * 2,
    local: scannerState(),
    db: note,
  };
}
