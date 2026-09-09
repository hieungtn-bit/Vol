/**
 * ĐỐI CHIẾU CÁC PHIÊN BẢN THUẬT TOÁN.
 *
 *   npx tsx scripts/versions.ts --tf 15m,1h,4h --bars 3000 [--deriv]
 *
 * Cùng một code path, khác nhau bằng cấu hình (lib/versions.ts). Cùng dữ liệu,
 * cùng nến 1m gỡ thứ tự, cùng phái sinh. Chọn trên nửa đầu, xác nhận trên nửa
 * sau — không kết luận từ chính con số đã dùng để nghĩ ra giả thuyết.
 *
 * Có ĐỐI CHỨNG NGƯỢC. Không có nó thì mọi cải thiện đều có thể chỉ là đổi tham
 * số gặp may.
 */
import { DEFAULT_BT, runBacktest, stats, type SimContext, type Trade } from '../lib/backtest';
import { loadDerivArchive } from '../lib/archiveDeriv';
import { loadMinutes, minuteFeed } from '../lib/minute';
import { TF_MS, fetchKlinesHistory } from '../lib/sources';
import { V1, V2, V_CONTROL, weightTotal, type EngineVersion } from '../lib/versions';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));
const withDeriv = process.argv.includes('--deriv');

const VERSIONS: EngineVersion[] = [V1, V2, V_CONTROL];

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

interface Row { n: number; win: number; avgR: number; totalR: number; pf: number; dd: number }
function row(t: Trade[], gate: boolean): Row {
  const s = stats(gate ? t.filter((x) => x.tradeable) : t);
  return { n: s.trades, win: s.winRate, avgR: s.avgR, totalR: s.totalR, pf: s.profitFactor, dd: s.maxDrawdownR };
}
function show(name: string, r: Row) {
  if (!r.n) { console.log(`  ${pad(name, 22)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 22)} n=${pad(r.n, 6)} win=${pad(num(r.win, 1) + '%', 7)} avgR=${pad(num(r.avgR), 7)}` +
    ` tổngR=${pad(num(r.totalR, 1), 8)} PF=${pad(num(r.pf), 6)} DD=${num(r.dd, 1)}`,
  );
}

/**
 * Sai số chuẩn của avgR. Không có nó thì không phân biệt được "tốt hơn" với
 * "khác đi vì ngẫu nhiên" — và với n vài chục thì phần lớn chênh lệch là cái sau.
 */
function se(t: Trade[]): number {
  if (t.length < 2) return NaN;
  const m = t.reduce((s, x) => s + x.r, 0) / t.length;
  const v = t.reduce((s, x) => s + (x.r - m) ** 2, 0) / (t.length - 1);
  return Math.sqrt(v / t.length);
}

async function main() {
  console.log(`Đối chiếu phiên bản · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến`);
  console.log(`Phái sinh: ${withDeriv ? 'CÓ' : 'mù'} · thứ tự trong nến: gỡ bằng nến 1m\n`);
  for (const v of VERSIONS) {
    if (weightTotal(v.weights) !== weightTotal(V1.weights)) {
      throw new Error(`${v.id}: tổng trọng số lệch — hạng sẽ đổi nghĩa, mọi so sánh vô nghĩa`);
    }
  }

  type Cell = { candles: Awaited<ReturnType<typeof fetchKlinesHistory>>; ctx: SimContext; tf: TF; symbol: string;
                src: { archive: Awaited<ReturnType<typeof loadDerivArchive>>; tfMs: number } | null };
  const cells: Cell[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      const from = candles[0].t, to = candles[candles.length - 1].t + TF_MS[tf];
      const m = await loadMinutes(symbol, from, to, 'spot');
      const src = withDeriv ? { archive: await loadDerivArchive(symbol, from, to), tfMs: TF_MS[tf] } : null;
      cells.push({ candles, tf, symbol, ctx: { minutes: minuteFeed(m), tfMs: TF_MS[tf] }, src });
      process.stdout.write('.');
    }
  }
  console.log(`\n${cells.length} cặp mã×khung.\n`);

  const results = new Map<string, { first: Trade[]; second: Trade[]; all: Trade[] }>();

  for (const v of VERSIONS) {
    const all: Trade[] = [];
    for (const c of cells) {
      all.push(...runBacktest(
        c.symbol, c.tf, c.candles,
        { ...DEFAULT_BT, weights: v.weights, levelCfg: v.levels },
        c.ctx, c.src,
      ));
    }
    const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
    const cut = Math.floor(sorted.length / 2);
    results.set(v.id, { first: sorted.slice(0, cut), second: sorted.slice(cut), all: sorted });

    const w = v.weights;
    console.log(`── ${v.id.toUpperCase()} · ${v.name} ──`);
    console.log(`   cấu trúc ${w.structure} · taker ${w.takerFlow} · PA ${w.priceAction} · VA ${w.valueLocation} · OI ${w.openInterest} · funding ${w.funding} · sàn phí ×${v.levels.costFloorMult}`);
    show('mọi lệnh · nửa đầu', row(sorted.slice(0, cut), false));
    show('mọi lệnh · NỬA SAU', row(sorted.slice(cut), false));
    show('qua cửa · nửa đầu', row(sorted.slice(0, cut), true));
    show('qua cửa · NỬA SAU', row(sorted.slice(cut), true));
    console.log('');
  }

  // ---- Bảng đối chiếu, cột NỬA SAU là cột quyết định ----
  console.log('══ ĐỐI CHIẾU (cột NỬA SAU là cột quyết định) ══');
  console.log(`  ${pad('bản', 14)} ${pad('mọi lệnh sau', 26)} ${pad('qua cửa sau', 26)}`);
  for (const v of VERSIONS) {
    const r = results.get(v.id)!;
    const a = row(r.second, false), b = row(r.second, true);
    const gateTrades = r.second.filter((t) => t.tradeable);
    console.log(
      `  ${pad(v.id, 14)} ` +
      `${pad(`avgR ${num(a.avgR)} PF ${num(a.pf)} n=${a.n}`, 26)} ` +
      `${pad(`avgR ${num(b.avgR)} PF ${num(b.pf)} n=${b.n}`, 26)} ` +
      `± ${num(se(gateTrades), 3)}`,
    );
  }

  console.log('\n  Cột cuối là SAI SỐ CHUẨN của avgR ở phần qua cửa. Chênh lệch giữa hai');
  console.log('  bản nhỏ hơn khoảng hai lần sai số đó thì KHÔNG phân biệt được với ngẫu nhiên.');
}

main().catch((e) => { console.error(e); process.exit(1); });
