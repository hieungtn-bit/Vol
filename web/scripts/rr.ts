/**
 * TỶ LỆ RR NÀO ĐÁNG NHẬN — đo, không đoán.
 *
 *   npx tsx scripts/rr.ts --tf 15m,1h,4h --bars 3000
 *
 * Câu hỏi thực dụng không phải "RR bao nhiêu là đẹp" mà "khoảng RR nào đáng
 * nhận, khoảng nào nên bỏ". Hệ KHÔNG cho chọn RR tuỳ ý — RR rơi ra từ chỗ các
 * mốc cấu trúc nằm, nên thứ dùng được là một luật lọc, không phải một mục tiêu.
 *
 * Bucket theo `rewardR` = 0.5×rr1 + 0.5×rr2 — đúng con số bảng vào tiền hiển
 * thị và đúng payout mà simulate() trả.
 *
 * Chia đôi mẫu theo thời gian. Một khoảng chỉ đáng tin khi nó dương ở CẢ HAI
 * nửa; đẹp ở nửa đầu rồi đảo chiều ở nửa sau là uốn tham số.
 */
import { DEFAULT_BT, runBacktest, stats, type Trade } from '../lib/backtest';
import { fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

const EDGES = [0, 0.5, 0.8, 1.1, 1.5, 2.0, 3.0, Infinity];
const nhan = (i: number) => `${EDGES[i].toFixed(1)}–${EDGES[i + 1] === Infinity ? '∞' : EDGES[i + 1].toFixed(1)}`;

/** Sai số chuẩn — không có nó thì không phân biệt "tốt hơn" với "khác đi". */
function se(t: Trade[]): number {
  if (t.length < 2) return NaN;
  const m = t.reduce((s, x) => s + x.r, 0) / t.length;
  const v = t.reduce((s, x) => s + (x.r - m) ** 2, 0) / (t.length - 1);
  return Math.sqrt(v / t.length);
}

function bang(ts: Trade[], tieuDe: string) {
  console.log(`\n── ${tieuDe} (n=${ts.length}) ──`);
  console.log(`  ${pad('RR kế hoạch', 13)} ${pad('n', 6)} ${pad('thắng', 8)} ${pad('chạm TP1', 10)} ${pad('chạm TP2', 10)} ${pad('avgR', 8)} ${pad('PF', 7)} sai số`);
  for (let i = 0; i < EDGES.length - 1; i++) {
    const c = ts.filter((t) => t.rewardR != null && t.rewardR >= EDGES[i] && t.rewardR < EDGES[i + 1]);
    if (!c.length) continue;
    const s = stats(c);
    console.log(
      `  ${pad(nhan(i), 13)} ${pad(c.length, 6)} ${pad(num(s.winRate, 1) + '%', 8)}` +
      ` ${pad(num(s.tp1Rate, 1) + '%', 10)} ${pad(num(s.tp2Rate, 1) + '%', 10)}` +
      ` ${pad(num(s.avgR), 8)} ${pad(num(s.profitFactor), 7)} ±${num(se(c), 3)}`,
    );
  }
}

async function main() {
  console.log(`RR nào đáng nhận · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến`);

  const all: Trade[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      all.push(...runBacktest(symbol, tf, candles, DEFAULT_BT));
      process.stdout.write('.');
    }
  }
  console.log('');

  const qua = all.filter((t) => t.tradeable);
  const sorted = [...qua].sort((a, b) => a.signalTime - b.signalTime);
  const cut = Math.floor(sorted.length / 2);

  console.log(`\n${all.length} lệnh, trong đó ${qua.length} qua cửa. Chỉ xét kèo QUA CỬA —`);
  console.log('vì đó là thứ bảng vào tiền hiển thị, và là lớp kèo duy nhất đo ra dương.');

  bang(qua, 'TOÀN MẪU · qua cửa');
  bang(sorted.slice(0, cut), 'NỬA ĐẦU');
  bang(sorted.slice(cut), 'NỬA SAU (ngoài mẫu)');

  // Luật lọc: bỏ dưới ngưỡng X thì còn lại bao nhiêu và tốt lên hay không.
  console.log('\n── nếu BỎ những kèo có RR dưới ngưỡng ──');
  console.log(`  ${pad('ngưỡng', 10)} ${pad('giữ lại', 9)} ${pad('avgR', 8)} ${pad('PF', 7)} | ${pad('ngoài mẫu n', 13)} ${pad('avgR', 8)} PF`);
  for (const th of [0, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0]) {
    const keep = qua.filter((t) => (t.rewardR ?? 0) >= th);
    if (!keep.length) continue;
    const s = stats(keep);
    const k = [...keep].sort((a, b) => a.signalTime - b.signalTime);
    const oos = stats(k.slice(Math.floor(k.length / 2)));
    console.log(
      `  ${pad('≥ ' + th.toFixed(1), 10)} ${pad(keep.length + ` (${num((keep.length / qua.length) * 100, 0)}%)`, 9)}` +
      ` ${pad(num(s.avgR), 8)} ${pad(num(s.profitFactor), 7)} | ${pad(oos.trades, 13)} ${pad(num(oos.avgR), 8)} ${num(oos.profitFactor)}`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
