/**
 * Chạy backtest.
 *
 *   npm run backtest -- --symbols BTCUSDT,ETHUSDT --tf 1h --bars 3000
 *   npm run backtest -- --tf 15m --min A
 *
 * Backtest này chạy MÙ PHÁI SINH: từ môi trường không vào được fapi.binance.com,
 * OI / funding / taker perp đều N/A. Nó kiểm chứng phần Price Action + Volume
 * Profile + cấu trúc HH/HL + taker SPOT, tức đúng những vế luôn có dữ liệu lịch sử.
 */
import { DEFAULT_BT, evidenceEdge, runBacktest, stats, type Trade } from '../lib/backtest';
import { fetchKlinesHistory } from '../lib/sources';
import type { Conviction } from '../lib/direct';
import type { TF } from '../lib/types';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT') as string).split(',');
const tfs = (arg('tf', '1h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));
const minConviction = (arg('min', 'C') as Conviction);

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');

function row(name: string, t: Trade[]) {
  const s = stats(t);
  if (s.trades === 0) { console.log(`  ${pad(name, 22)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 22)} n=${pad(s.trades, 5)} win=${pad(num(s.winRate, 1) + '%', 7)}` +
    ` avgR=${pad(num(s.avgR), 7)} tổngR=${pad(num(s.totalR, 1), 8)}` +
    ` PF=${pad(num(s.profitFactor), 6)} DD=${pad(num(s.maxDrawdownR, 1), 7)}` +
    ` TP1=${num(s.tp1Rate, 0)}% TP2=${num(s.tp2Rate, 0)}%`,
  );
}

async function main() {
  console.log(`Backtest · ${symbols.join(', ')} · ${tfs.join(', ')} · ${bars} nến · hạng ≥ ${minConviction}`);
  console.log('Mù phái sinh: OI / funding / taker perp = N/A (fapi không truy cập được từ đây)\n');

  const all: Trade[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) { console.log(`  ${symbol} ${tf}: chỉ ${candles.length} nến, bỏ qua`); continue; }
      const t = runBacktest(symbol, tf, candles, { ...DEFAULT_BT, minConviction });
      const from = new Date(candles[0].t).toISOString().slice(0, 10);
      const to = new Date(candles[candles.length - 1].t).toISOString().slice(0, 10);
      row(`${symbol} ${tf}`, t);
      if (t.length) console.log(`  ${pad('', 22)} (${candles.length} nến, ${from} → ${to})`);
      all.push(...t);
    }
  }

  if (all.length === 0) { console.log('\nKhông có lệnh nào.'); return; }

  console.log('\n── TỔNG ──');
  row('tất cả', all);

  console.log('\n── theo hạng tin cậy ──');
  for (const c of ['GOLD', 'A', 'B', 'C'] as Conviction[]) row(c, all.filter((t) => t.conviction === c));

  console.log('\n── theo hướng ──');
  row('LONG', all.filter((t) => t.side === 'LONG'));
  row('SHORT', all.filter((t) => t.side === 'SHORT'));

  console.log('\n── theo khung ──');
  for (const tf of tfs) row(tf, all.filter((t) => t.tf === tf));

  console.log('\n── kiểu thoát lệnh ──');
  const byExit = new Map<string, Trade[]>();
  for (const t of all) byExit.set(t.exitReason, [...(byExit.get(t.exitReason) ?? []), t]);
  for (const [k, v] of [...byExit].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${pad(k, 22)} n=${pad(v.length, 5)} (${num((v.length / all.length) * 100, 1)}%) avgR=${num(v.reduce((s, t) => s + t.r, 0) / v.length)}`);
  }

  console.log('\n── EDGE THẬT CỦA TỪNG VẾ CHẤM ĐIỂM ──');
  console.log('  (avgR khi vế đó ủng hộ hướng đã vào, trừ avgR khi nó chống lại)');
  for (const e of evidenceEdge(all)) {
    const flag = e.edge > 0.05 ? '✓ có edge' : e.edge < -0.05 ? '✗ NGƯỢC' : '· nhiễu';
    console.log(
      `  ${pad(e.label, 26)} ủng hộ n=${pad(e.agreeN, 5)} avgR=${pad(num(e.agreeR), 7)}` +
      ` | chống n=${pad(e.againstN, 5)} avgR=${pad(num(e.againstR), 7)}` +
      ` | edge=${pad(num(e.edge), 7)} ${flag}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
