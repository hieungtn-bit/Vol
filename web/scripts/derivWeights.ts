/**
 * Kiểm định một giả thuyết CỤ THỂ, không phải quét trọng số.
 *
 *   npx tsx scripts/derivWeights.ts --tf 15m,1h,4h --bars 3000
 *
 * Lần đo phái sinh đầu tiên (bench/phai-sinh.txt) nói ba điều:
 *   Taker Buy/Sell  edge +0.29 (n=1871) — perp làm vế này TỐT HẲN LÊN (mù: +0.12)
 *   Open Interest   edge +0.05 (n=1260) — dương yếu
 *   Funding         edge −0.14 (n=139)  — ĐI NGƯỢC
 *
 * Giả thuyết: vế funding đang làm hại, và bỏ trọng số của nó thì phần lệnh qua
 * cửa hồi lại. Kiểm bằng cách CHỌN TRÊN NỬA ĐẦU, XÁC NHẬN TRÊN NỬA SAU — không
 * kết luận từ chính con số đã dùng để nghĩ ra giả thuyết.
 */
import { DEFAULT_BT, runBacktest, stats, type SimContext, type Trade } from '../lib/backtest';
import { loadDerivArchive } from '../lib/archiveDeriv';
import { W, type Weights } from '../lib/direct';
import { loadMinutes, minuteFeed } from '../lib/minute';
import { TF_MS, fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

/**
 * Bốn biến thể. Tổng trọng số giữ nguyên 103 ở mọi biến thể — ngưỡng hạng
 * (net ≥ 30 = A, ≥ 15 = B) so trên thang tuyệt đối, nên đổi tổng là đổi luôn ý
 * nghĩa của hạng và mọi so sánh thành vô nghĩa.
 */
const VARIANTS: { name: string; w: Weights }[] = [
  { name: 'đang chạy', w: W },
  // Bỏ funding, chia phần của nó cho taker (vế đo được là tốt nhất).
  { name: 'bỏ funding', w: { ...W, funding: 0, takerFlow: W.takerFlow + W.funding } },
  // Bỏ cả funding lẫn OI, dồn hết cho taker.
  { name: 'bỏ funding + OI', w: { ...W, funding: 0, openInterest: 0, takerFlow: W.takerFlow + W.funding + W.openInterest } },
  // Đối chứng ngược: tăng funding. Nếu giả thuyết đúng thì cái này phải TỆ hơn.
  { name: 'đối chứng: tăng funding', w: { ...W, funding: W.funding * 2, takerFlow: W.takerFlow - W.funding } },
];

function line(name: string, t: Trade[], gate: boolean) {
  const s = stats(gate ? t.filter((x) => x.tradeable) : t);
  if (!s.trades) { console.log(`  ${pad(name, 24)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 24)} n=${pad(s.trades, 6)} win=${pad(num(s.winRate, 1) + '%', 7)}` +
    ` avgR=${pad(num(s.avgR), 7)} PF=${pad(num(s.profitFactor), 6)} DD=${num(s.maxDrawdownR, 1)}`,
  );
}

async function main() {
  console.log(`Kiểm định giả thuyết "funding đang làm hại" · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến\n`);

  type Cell = { candles: Awaited<ReturnType<typeof fetchKlinesHistory>>; ctx: SimContext;
                src: { archive: Awaited<ReturnType<typeof loadDerivArchive>>; tfMs: number }; tf: TF; symbol: string };
  const cells: Cell[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      const from = candles[0].t, to = candles[candles.length - 1].t + TF_MS[tf];
      const archive = await loadDerivArchive(symbol, from, to);
      const m = await loadMinutes(symbol, from, to);
      cells.push({ candles, tf, symbol, ctx: { minutes: minuteFeed(m), tfMs: TF_MS[tf] }, src: { archive, tfMs: TF_MS[tf] } });
      process.stdout.write('.');
    }
  }
  console.log(`\n${cells.length} cặp mã×khung.\n`);

  for (const v of VARIANTS) {
    const all: Trade[] = [];
    for (const c of cells) {
      all.push(...runBacktest(c.symbol, c.tf, c.candles, { ...DEFAULT_BT, weights: v.w }, c.ctx, c.src));
    }
    const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
    const cut = Math.floor(sorted.length / 2);
    console.log(`── ${v.name} (funding ${v.w.funding}, taker ${v.w.takerFlow}, OI ${v.w.openInterest}) ──`);
    line('mọi lệnh · nửa đầu', sorted.slice(0, cut), false);
    line('mọi lệnh · NỬA SAU', sorted.slice(cut), false);
    line('qua cửa · nửa đầu', sorted.slice(0, cut), true);
    line('qua cửa · NỬA SAU', sorted.slice(cut), true);
    console.log('');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
