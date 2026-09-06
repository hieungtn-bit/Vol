/**
 * THAY GIẢ ĐỊNH BẰNG SỐ ĐO.
 *
 *   npx tsx scripts/intrabar.ts --symbols ENAUSDT --tf 1h --bars 3000
 *
 * Chạy CÙNG một backtest hai lần trên CÙNG dữ liệu nến lớn: một lần với giả định
 * thận trọng (trong nến không biết thứ tự → tính SL trước, không tính chốt lời
 * trên nến vào lệnh), một lần với nến 1m gỡ đúng thứ tự đã xảy ra.
 *
 * Chênh lệch giữa hai lần chính là cái giá của giả định.
 */
import { DEFAULT_BT, runBacktest, stats, type Trade } from '../lib/backtest';
import { loadMinutes, minuteFeed } from '../lib/minute';
import { TF_MS, fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT') as string).split(',');
const tfs = (arg('tf', '1h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

function row(name: string, t: Trade[]) {
  const s = stats(t);
  if (!s.trades) { console.log(`  ${pad(name, 26)} (không có lệnh)`); return; }
  const resolved = t.filter((x) => x.intrabarResolved).length;
  console.log(
    `  ${pad(name, 26)} n=${pad(s.trades, 6)} win=${pad(num(s.winRate, 1) + '%', 7)}` +
    ` avgR=${pad(num(s.avgR), 7)} tổngR=${pad(num(s.totalR, 1), 8)} PF=${pad(num(s.profitFactor), 6)}` +
    ` DD=${pad(num(s.maxDrawdownR, 1), 7)} gỡ được ${num((resolved / s.trades) * 100, 0)}%`,
  );
}

async function main() {
  console.log(`Giả định thận trọng vs nến 1m · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến\n`);
  const gia: Trade[] = [];
  const do_: Trade[] = [];

  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) { console.log(`  ${symbol} ${tf}: chỉ ${candles.length} nến, bỏ`); continue; }

      const from = candles[0].t;
      const to = candles[candles.length - 1].t + TF_MS[tf];
      process.stdout.write(`  tải nến 1m ${symbol} (${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)}) … `);
      const m = await loadMinutes(symbol, from, to);
      console.log(`${m.length} nến`);

      const ctx = { minutes: minuteFeed(m), tfMs: TF_MS[tf] };
      const a = runBacktest(symbol, tf, candles, DEFAULT_BT);
      const b = runBacktest(symbol, tf, candles, DEFAULT_BT, ctx);
      console.log(`  ── ${symbol} ${tf} ──`);
      row('giả định thận trọng', a);
      row('nến 1m gỡ thứ tự', b);
      gia.push(...a);
      do_.push(...b);
    }
  }

  if (!gia.length) return;
  console.log('\n── TỔNG ──');
  row('giả định thận trọng', gia);
  row('nến 1m gỡ thứ tự', do_);

  const sa = stats(gia), sb = stats(do_);
  console.log(
    `\n  Giả định thận trọng đang tính THIẾU ${num(sb.avgR - sa.avgR, 3)}R mỗi lệnh ` +
    `(avgR ${num(sa.avgR)} → ${num(sb.avgR)}, PF ${num(sa.profitFactor)} → ${num(sb.profitFactor)}).`,
  );

  // Bao nhiêu lệnh THẬT SỰ đổi kết quả, và đổi theo chiều nào.
  const key = (t: Trade) => `${t.symbol}|${t.tf}|${t.signalIdx}`;
  const mapB = new Map(do_.map((t) => [key(t), t]));
  let doi = 0, tot = 0, len = 0, xuong = 0;
  for (const t of gia) {
    const u = mapB.get(key(t));
    if (!u) continue;
    tot++;
    if (u.exitReason !== t.exitReason) { doi++; if (u.r > t.r) len++; else if (u.r < t.r) xuong++; }
  }
  console.log(
    `  ${doi}/${tot} lệnh đổi kết quả khi biết thứ tự thật (${num((doi / tot) * 100, 1)}%) — ` +
    `${len} tốt lên, ${xuong} xấu đi.`,
  );

  console.log('\n── chỉ tính các lệnh ĐÃ GỠ ĐƯỢC bằng nến 1m ──');
  const goDuoc = new Set(do_.filter((t) => t.intrabarResolved).map(key));
  row('giả định', gia.filter((t) => goDuoc.has(key(t))));
  row('số đo', do_.filter((t) => t.intrabarResolved));
}

main().catch((e) => { console.error(e); process.exit(1); });
