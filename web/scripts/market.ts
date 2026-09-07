/**
 * NẾN SPOT hay NẾN PERP?
 *
 *   npx tsx scripts/market.ts --tf 15m,1h,4h --bars 3000
 *
 * Hệ khuyến nghị lệnh trên PERP, nhưng cả đường live lẫn backtest đều dựng volume
 * profile, price action, cấu trúc và mọi mức giá từ nến SPOT. Backtest vì thế
 * KHÔNG sai so với live — cả hai cùng lệch một kiểu. Câu hỏi ở đây là: chỗ lệch
 * đó có thật sự đổi kết quả không, tức có đáng đổi production không.
 *
 * CHỈ MỘT BIẾN ĐỔI: nguồn nến. Cùng engine, cùng khoảng thời gian, cùng ĐÚNG
 * những mốc nến (giao hai chuỗi theo timestamp), cùng phái sinh. Nến 1m gỡ thứ
 * tự cũng lấy đúng chợ đang mô phỏng — dùng 1m spot để phân xử một nến perp là
 * để giá của chợ khác quyết định lệnh chạm stop hay chạm mục tiêu trước.
 */
import { DEFAULT_BT, runBacktest, stats, type SimContext, type Trade } from '../lib/backtest';
import { loadDerivArchive, loadPerpCandles } from '../lib/archiveDeriv';
import { loadMinutes, minuteFeed } from '../lib/minute';
import { TF_MS, fetchKlinesHistory } from '../lib/sources';
import type { Candle, TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));
/**
 * Cờ boolean phải hỏi `includes`, KHÔNG hỏi `arg()`.
 *
 * `arg()` trả về giá trị ĐỨNG SAU cờ, nên `--deriv` ở cuối dòng lệnh luôn cho
 * undefined và cờ im lặng thành false. Lần chạy đầu tiên dính đúng lỗi này: hai
 * file kết quả ra giống hệt nhau vì cả hai đều chạy mù phái sinh.
 */
const withDeriv = process.argv.includes('--deriv');

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

function line(name: string, t: Trade[], gate = false) {
  const s = stats(gate ? t.filter((x) => x.tradeable) : t);
  if (!s.trades) { console.log(`  ${pad(name, 26)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 26)} n=${pad(s.trades, 6)} win=${pad(num(s.winRate, 1) + '%', 7)}` +
    ` avgR=${pad(num(s.avgR), 7)} tổngR=${pad(num(s.totalR, 1), 8)} PF=${pad(num(s.profitFactor), 6)} DD=${num(s.maxDrawdownR, 1)}`,
  );
}

/** Giao hai chuỗi theo timestamp — hai bên phải có ĐÚNG cùng những cây nến. */
function align(a: Candle[], b: Candle[]): [Candle[], Candle[]] {
  const setB = new Set(b.map((c) => c.t));
  const outA = a.filter((c) => setB.has(c.t));
  const setA = new Set(outA.map((c) => c.t));
  return [outA, b.filter((c) => setA.has(c.t))];
}

async function main() {
  console.log(`Nến spot vs nến perp · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến`);
  console.log(`Phái sinh: ${withDeriv ? 'CÓ' : 'mù (để chỉ còn một biến đổi)'}\n`);

  const spotAll: Trade[] = [];
  const perpAll: Trade[] = [];
  let cmpN = 0, cmpSum = 0, cmpMax = 0, volRatioSum = 0, volN = 0;

  for (const tf of tfs) {
    for (const symbol of symbols) {
      const rawSpot = await fetchKlinesHistory(symbol, tf, bars);
      if (rawSpot.length < 200) continue;
      const from = rawSpot[0].t, to = rawSpot[rawSpot.length - 1].t + TF_MS[tf];
      const rawPerp = await loadPerpCandles(symbol, tf, from, to);
      if (rawPerp.length < 200) { console.log(`  ${symbol} ${tf}: kho thiếu nến perp (${rawPerp.length}), bỏ`); continue; }

      const [spot, perp] = align(rawSpot, rawPerp);
      if (spot.length < 200) { console.log(`  ${symbol} ${tf}: giao chỉ còn ${spot.length} nến, bỏ`); continue; }

      // Hai chợ khác nhau bao nhiêu — để biết kết quả khác là do đâu.
      for (let i = 0; i < spot.length; i++) {
        const d = Math.abs(perp[i].c - spot[i].c) / spot[i].c * 100;
        cmpN++; cmpSum += d; cmpMax = Math.max(cmpMax, d);
        if (spot[i].v > 0) { volRatioSum += perp[i].v / spot[i].v; volN++; }
      }

      const [ms, mp] = await Promise.all([
        loadMinutes(symbol, from, to, 'spot'),
        loadMinutes(symbol, from, to, 'perp'),
      ]);
      const ctxS: SimContext = { minutes: minuteFeed(ms), tfMs: TF_MS[tf] };
      const ctxP: SimContext = { minutes: minuteFeed(mp), tfMs: TF_MS[tf] };

      const src = withDeriv
        ? { archive: await loadDerivArchive(symbol, from, to), tfMs: TF_MS[tf] }
        : null;

      const a = runBacktest(symbol, tf, spot, DEFAULT_BT, ctxS, src);
      const b = runBacktest(symbol, tf, perp, DEFAULT_BT, ctxP, src);
      console.log(`  ── ${symbol} ${tf} (${spot.length} nến khớp) ──`);
      line('nến spot', a);
      line('nến perp', b);
      spotAll.push(...a); perpAll.push(...b);
    }
  }

  if (!perpAll.length) { console.log('\nKhông có lệnh nào.'); return; }

  console.log(`\n── hai chợ khác nhau bao nhiêu ──`);
  console.log(`  giá đóng lệch trung bình ${num(cmpSum / cmpN, 4)}% · lớn nhất ${num(cmpMax, 3)}%`);
  console.log(`  volume perp / volume spot trung bình ${num(volRatioSum / volN, 2)}×`);

  console.log('\n══ TỔNG ══');
  line('nến spot', spotAll);
  line('nến perp', perpAll);

  const oos = (t: Trade[], gate: boolean) => {
    const s = [...t].sort((x, y) => x.signalTime - y.signalTime);
    const half = s.slice(Math.floor(s.length / 2));
    return stats(gate ? half.filter((x) => x.tradeable) : half);
  };
  console.log('\n  Ngoài mẫu (nửa sau theo thời gian):');
  console.log(`    spot  n=${pad(oos(spotAll, false).trades, 6)} avgR=${num(oos(spotAll, false).avgR)} PF=${num(oos(spotAll, false).profitFactor)}`);
  console.log(`    perp  n=${pad(oos(perpAll, false).trades, 6)} avgR=${num(oos(perpAll, false).avgR)} PF=${num(oos(perpAll, false).profitFactor)}`);

  console.log('\n── chỉ lệnh QUA CỬA ──');
  line('nến spot', spotAll, true);
  line('nến perp', perpAll, true);
  console.log('  ngoài mẫu:');
  console.log(`    spot  n=${pad(oos(spotAll, true).trades, 6)} avgR=${num(oos(spotAll, true).avgR)} PF=${num(oos(spotAll, true).profitFactor)}`);
  console.log(`    perp  n=${pad(oos(perpAll, true).trades, 6)} avgR=${num(oos(perpAll, true).avgR)} PF=${num(oos(perpAll, true).profitFactor)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
