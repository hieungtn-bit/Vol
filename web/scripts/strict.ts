/**
 * ĐO ĐƯỜNG STRICT — lần đầu tiên.
 *
 *   npx tsx scripts/strict.ts --tf 15m,1h,4h --bars 3000 [--intrabar 1m]
 *
 * Đường strict (`decideBias`) chưa từng được backtest. Ngưỡng score ≥ 7, các
 * trọng số hợp lưu, và khoản phạt RR TP1 đều chưa qua một lần đo nào.
 *
 * Chạy hai cấu hình trên CÙNG dữ liệu, chỉ khác một luật:
 *   - CÓ phạt RR TP1 < 1.2  (đang chạy)
 *   - BỎ phạt               (đã bỏ ở decideDirection từ lâu, sót lại ở đây)
 */
import { DEFAULT_BT, stats, type SimContext, type Trade } from '../lib/backtest';
import { runBacktestStrict } from '../lib/backtestStrict';
import { loadMinutes, minuteFeed } from '../lib/minute';
import { TF_MS, fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));
const useMinutes = arg('intrabar') === '1m';

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

function show(name: string, t: Trade[], barsSeen: number, signals: number) {
  const s = stats(t);
  const rate = barsSeen ? (signals / barsSeen) * 100 : 0;
  if (!s.trades) {
    console.log(`  ${pad(name, 24)} ${signals} tín hiệu / ${barsSeen} nến (${num(rate, 2)}%) — KHÔNG có lệnh nào khớp`);
    return;
  }
  console.log(
    `  ${pad(name, 24)} tín hiệu ${pad(signals, 6)} (${pad(num(rate, 2) + '%', 7)})` +
    ` n=${pad(s.trades, 5)} win=${pad(num(s.winRate, 1) + '%', 7)} avgR=${pad(num(s.avgR), 7)}` +
    ` tổngR=${pad(num(s.totalR, 1), 8)} PF=${pad(num(s.profitFactor), 6)} DD=${num(s.maxDrawdownR, 1)}`,
  );
}

async function main() {
  console.log(`Đường STRICT · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến`);
  console.log(`Thứ tự trong nến: ${useMinutes ? 'gỡ bằng nến 1m' : 'giả định thận trọng'}\n`);

  const acc = {
    co: { bars: 0, signals: 0, trades: [] as Trade[] },
    bo: { bars: 0, signals: 0, trades: [] as Trade[] },
  };

  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      let ctx: SimContext | undefined;
      if (useMinutes) {
        const from = candles[0].t, to = candles[candles.length - 1].t + TF_MS[tf];
        ctx = { minutes: minuteFeed(await loadMinutes(symbol, from, to, 'spot')), tfMs: TF_MS[tf] };
      }
      const a = runBacktestStrict(symbol, tf, candles, DEFAULT_BT, ctx, { rr1Penalty: true });
      const b = runBacktestStrict(symbol, tf, candles, DEFAULT_BT, ctx, { rr1Penalty: false });
      acc.co.bars += a.bars; acc.co.signals += a.signals; acc.co.trades.push(...a.trades);
      acc.bo.bars += b.bars; acc.bo.signals += b.signals; acc.bo.trades.push(...b.trades);
      process.stdout.write('.');
    }
  }
  console.log('\n');

  console.log('══ TOÀN MẪU ══');
  show('CÓ phạt (đang chạy)', acc.co.trades, acc.co.bars, acc.co.signals);
  show('BỎ phạt', acc.bo.trades, acc.bo.bars, acc.bo.signals);

  const half = (t: Trade[]) => {
    const s = [...t].sort((a, b) => a.signalTime - b.signalTime);
    return stats(s.slice(Math.floor(s.length / 2)));
  };
  console.log('\n── ngoài mẫu (nửa sau theo thời gian) ──');
  for (const [k, v] of [['CÓ phạt', acc.co], ['BỎ phạt', acc.bo]] as const) {
    const h = half(v.trades);
    console.log(`  ${pad(k, 24)} n=${pad(h.trades, 5)} avgR=${pad(num(h.avgR), 7)} PF=${num(h.profitFactor)}`);
  }

  // Sai số chuẩn — không có nó thì không phân biệt được "tốt hơn" với "khác đi".
  const se = (t: Trade[]) => {
    if (t.length < 2) return NaN;
    const m = t.reduce((s, x) => s + x.r, 0) / t.length;
    const v = t.reduce((s, x) => s + (x.r - m) ** 2, 0) / (t.length - 1);
    return Math.sqrt(v / t.length);
  };
  console.log(`\n  sai số chuẩn avgR: có phạt ±${num(se(acc.co.trades), 3)} · bỏ phạt ±${num(se(acc.bo.trades), 3)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
