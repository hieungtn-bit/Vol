/**
 * Backtest trên THƯỚC MỚI.
 *   npm run backtest:new -- --symbols BTCUSDT,ETHUSDT --tf 1h --bars 6000
 */
import { DEFAULT_BT, stats, type Trade } from '../lib/backtest';
import { runBacktestNew } from '../lib/backtestNew';
import { fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
}
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ENAUSDT') as string).split(',');
const tfs = (arg('tf', '1h,4h') as string).split(',') as TF[];
const bars15 = Number(arg('bars', '6000'));
/** CHỈ để chẩn đoán. Không có cờ này thì dùng đúng sàn đang chạy thật (7). */
const floor = arg('floor') != null ? Number(arg('floor')) : undefined;

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');

function row(name: string, t: Trade[]) {
  const s = stats(t);
  if (!s.trades) { console.log(`  ${pad(name, 26)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 26)} n=${pad(s.trades, 5)} win=${pad(num(s.winRate, 1) + '%', 7)}`
    + ` avgR=${pad(num(s.avgR), 7)} tổngR=${pad(num(s.totalR, 1), 8)}`
    + ` PF=${pad(num(s.profitFactor), 6)} DD=${pad(num(s.maxDrawdownR, 1), 7)}`
    + ` TP1=${num(s.tp1Rate, 0)}% TP2=${num(s.tp2Rate, 0)}%`,
  );
}

async function main() {
  console.log(`Backtest THƯỚC MỚI · ${symbols.join(', ')} · ${tfs.join(', ')} · ${bars15} nến 15m`);
  console.log('Mù phái sinh: OI / funding / taker perp = N/A (fapi không truy cập được từ đây).');
  console.log('Phí: 0.05%/chiều + 0.02% trượt giá khi dính stop.');
  if (floor != null) console.log(`⚠ SÀN ĐIỂM HẠ XUỐNG ${floor} — chỉ để chẩn đoán, KHÔNG phải cấu hình đang chạy.\n`);
  else console.log('Sàn điểm 7 — đúng cấu hình đang chạy.\n');

  const all: Trade[] = [];
  const blockers = new Map<string, number>();
  const lineHits = new Map<string, number>();
  const scores: number[] = [];
  let bars = 0; let signals = 0;

  for (const symbol of symbols) {
    const c15 = await fetchKlinesHistory(symbol, '15m', bars15);
    if (c15.length < 1200) { console.log(`  ${symbol}: chỉ ${c15.length} nến 15m, bỏ qua`); continue; }
    const from = new Date(c15[0].t).toISOString().slice(0, 10);
    const to = new Date(c15[c15.length - 1].t).toISOString().slice(0, 10);
    for (const tf of tfs) {
      const r = runBacktestNew(symbol, tf, c15, DEFAULT_BT, 1000, floor);
      bars += r.bars; signals += r.signals;
      for (const b of r.blockers) blockers.set(b.reason, (blockers.get(b.reason) ?? 0) + b.n);
      for (const l of r.lineHits) lineHits.set(l.label, (lineHits.get(l.label) ?? 0) + l.n);
      scores.push(...r.scores);
      row(`${symbol} ${tf}`, r.trades);
      all.push(...r.trades);
    }
    console.log(`  ${pad('', 26)} (${c15.length} nến 15m, ${from} → ${to})`);
  }

  console.log('\n── TỔNG ──');
  row('tất cả', all);
  if (all.length) {
    const gross = all.reduce((s, t) => s + t.rGross, 0);
    const cost = all.reduce((s, t) => s + t.costR, 0);
    console.log(`  ${pad('', 26)} trước phí ${num(gross, 1)}R · phí ${num(cost, 1)}R (${num(cost / all.length, 3)}R/lệnh) · sau phí ${num(gross - cost, 1)}R`);

    const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
    const cut = Math.floor(sorted.length / 2);
    console.log('\n── tách theo thời gian ──');
    row('nửa đầu', sorted.slice(0, cut));
    row('nửa sau (ngoài mẫu)', sorted.slice(cut));

    console.log('\n── theo khung ──');
    for (const tf of tfs) row(tf, all.filter((t) => t.tf === tf));
    console.log('\n── theo hướng ──');
    row('mở mua', all.filter((t) => t.side === 'LONG'));
    row('mở bán', all.filter((t) => t.side === 'SHORT'));
    console.log('\n── theo khổ lệnh ──');
    row('khổ đủ', all.filter((t) => t.conviction === 'A'));
    row('khổ nửa', all.filter((t) => t.conviction === 'B'));

    console.log('\n── kiểu thoát lệnh ──');
    const byExit = new Map<string, Trade[]>();
    for (const t of all) byExit.set(t.exitReason, [...(byExit.get(t.exitReason) ?? []), t]);
    for (const [k, v] of [...byExit].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${pad(k, 26)} n=${pad(v.length, 5)} (${num((v.length / all.length) * 100, 1)}%) avgR=${num(v.reduce((s, t) => s + t.r, 0) / v.length)}`);
    }
  }

  console.log(`\n── TỶ LỆ RA LỆNH ──`);
  console.log(`  xét ${bars} nến · ra kế hoạch ${signals} (${num((signals / Math.max(1, bars)) * 100, 2)}%)`);
  if (scores.length) {
    const sorted = [...scores].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    console.log('\n── PHÂN BỐ ĐIỂM (điểm cao nhất của mỗi nến) ──');
    console.log(`  thấp nhất ${num(sorted[0], 1)} · trung vị ${num(q(0.5), 1)} · p90 ${num(q(0.9), 1)} · p99 ${num(q(0.99), 1)} · cao nhất ${num(sorted[sorted.length - 1], 1)}`);
    console.log('  số nến đạt từng mốc điểm:');
    for (const floor of [4, 5, 6, 6.5, 7, 7.5, 8]) {
      const n = scores.filter((x) => x >= floor).length;
      console.log(`    ≥ ${pad(floor, 4)} ${pad(n, 7)} (${num((n / scores.length) * 100, 2)}%)`);
    }
  }

  console.log('\n── VẾ NÀO THẬT SỰ BẮN ĐƯỢC ──');
  for (const [label, n] of [...lineHits].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(label, 42)} ${pad(n, 7)} (${num((n / Math.max(1, bars)) * 100, 1)}% số nến)`);
  }

  console.log('\n── VÌ SAO CÁC NẾN CÒN LẠI ĐỨNG NGOÀI ──');
  for (const [reason, n] of [...blockers].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(reason, 34)} ${pad(n, 7)} (${num((n / Math.max(1, bars)) * 100, 1)}% số nến)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
