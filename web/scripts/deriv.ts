/**
 * ĐO BA VẾ CHƯA TỪNG ĐƯỢC KIỂM CHỨNG: OI, funding, taker perp.
 *
 *   npx tsx scripts/deriv.ts --symbols ENAUSDT --tf 1h --bars 3000
 *
 * Ba vế này chiếm 40 trên 103 trọng số chấm điểm, nhưng backtest tới nay chạy mù
 * phái sinh nên chúng luôn N/A và edge của chúng luôn đo ra 0. Trọng số của
 * chúng là niềm tin, không phải bằng chứng.
 *
 * Chạy CÙNG một backtest hai lần trên CÙNG dữ liệu: một lần mù phái sinh, một
 * lần có phái sinh lịch sử từ kho lưu trữ. Chênh lệch chính là đóng góp thật của
 * ba vế đó.
 */
import { DEFAULT_BT, evidenceEdge, runBacktest, stats, type SimContext, type Trade } from '../lib/backtest';
import { loadDerivArchive } from '../lib/archiveDeriv';
import { loadMinutes, minuteFeed } from '../lib/minute';
import { TF_MS, fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT') as string).split(',');
const tfs = (arg('tf', '1h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));
const useMinutes = arg('intrabar') === '1m';

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

function row(name: string, t: Trade[]) {
  const s = stats(t);
  if (!s.trades) { console.log(`  ${pad(name, 22)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 22)} n=${pad(s.trades, 6)} win=${pad(num(s.winRate, 1) + '%', 7)}` +
    ` avgR=${pad(num(s.avgR), 7)} tổngR=${pad(num(s.totalR, 1), 8)} PF=${pad(num(s.profitFactor), 6)}` +
    ` DD=${num(s.maxDrawdownR, 1)}`,
  );
}

function edges(t: Trade[], title: string) {
  console.log(`\n── EDGE TỪNG VẾ · ${title} ──`);
  for (const e of evidenceEdge(t)) {
    const seen = e.agreeN + e.againstN;
    const verdict = seen < 100 ? '· quá ít mẫu'
      : e.edge > 0.05 ? '✓ có edge'
      : e.edge < -0.05 ? '✗ NGƯỢC'
      : '· nhiễu';
    console.log(
      `  ${pad(e.label, 34)} ủng hộ n=${pad(e.agreeN, 6)} avgR=${pad(num(e.agreeR), 7)}` +
      ` | chống n=${pad(e.againstN, 6)} avgR=${pad(num(e.againstR), 7)}` +
      ` | edge=${pad(num(e.edge), 7)} ${verdict}`,
    );
  }
}

async function main() {
  console.log(`Mù phái sinh vs có phái sinh · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến`);
  console.log(`Thứ tự trong nến: ${useMinutes ? 'gỡ bằng nến 1m' : 'giả định thận trọng'}\n`);

  const mu: Trade[] = [];
  const co: Trade[] = [];

  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) { console.log(`  ${symbol} ${tf}: chỉ ${candles.length} nến, bỏ`); continue; }
      const from = candles[0].t;
      const to = candles[candles.length - 1].t + TF_MS[tf];

      process.stdout.write(`  tải phái sinh ${symbol} ${tf} … `);
      const archive = await loadDerivArchive(symbol, from, to);
      console.log(
        `${archive.funding.length} kỳ funding · ${archive.metrics.length} ảnh OI · ${archive.perp15m.length} nến perp 15m`,
      );
      if (archive.funding.length === 0 && archive.metrics.length === 0) {
        console.log(`  ${symbol} ${tf}: kho không có phái sinh, bỏ qua`);
        continue;
      }

      let ctx: SimContext | undefined;
      if (useMinutes) {
        const m = await loadMinutes(symbol, from, to);
        ctx = { minutes: minuteFeed(m), tfMs: TF_MS[tf] };
      }

      const a = runBacktest(symbol, tf, candles, DEFAULT_BT, ctx);
      const b = runBacktest(symbol, tf, candles, DEFAULT_BT, ctx, { archive, tfMs: TF_MS[tf] });
      console.log(`  ── ${symbol} ${tf} ──`);
      row('mù phái sinh', a);
      row('có phái sinh', b);
      mu.push(...a); co.push(...b);
    }
  }

  if (!co.length) { console.log('\nKhông có lệnh nào.'); return; }

  console.log('\n══ TỔNG ══');
  row('mù phái sinh', mu);
  row('có phái sinh', co);

  const half = (t: Trade[]) => {
    const s = [...t].sort((x, y) => x.signalTime - y.signalTime);
    return stats(s.slice(Math.floor(s.length / 2)));
  };
  console.log(`\n  Ngoài mẫu (nửa sau theo thời gian):`);
  console.log(`    mù   avgR=${num(half(mu).avgR)} PF=${num(half(mu).profitFactor)}`);
  console.log(`    có   avgR=${num(half(co).avgR)} PF=${num(half(co).profitFactor)}`);

  edges(mu, 'MÙ PHÁI SINH');
  edges(co, 'CÓ PHÁI SINH');

  // Cùng cửa chất lượng, hai bên có khác nhau không.
  console.log('\n── chỉ lệnh QUA CỬA ──');
  row('mù phái sinh', mu.filter((t) => t.tradeable));
  row('có phái sinh', co.filter((t) => t.tradeable));
}

main().catch((e) => { console.error(e); process.exit(1); });
