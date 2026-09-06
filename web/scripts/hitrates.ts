/**
 * Đo TỈ LỆ CHẠM THẬT của TP1 và TP2, để thay nhãn "R kỳ vọng" — vốn chỉ là tỷ lệ
 * lời/lỗ của kế hoạch — bằng một kỳ vọng có xác suất.
 *
 *   npx tsx scripts/hitrates.ts --tf 1h --bars 3000
 *
 * Chia ô theo ĐỘ XA tính bằng R chứ không chỉ theo hạng. Lý do: p(chạm TP2) phụ
 * thuộc gần như hoàn toàn vào TP2 xa bao nhiêu. Nếu chỉ chia theo hạng thì một kế
 * hoạch đặt TP2 ở 10R sẽ nhận đúng xác suất như kế hoạch đặt ở 2R, và công thức
 * kỳ vọng sẽ thưởng cho việc kéo TP2 ra xa — đúng cái bệnh mà cửa maxRRBlended
 * đang phải chặn bằng tay.
 */
import { DEFAULT_BT, runBacktest, type Trade } from '../lib/backtest';
import { fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));

/** Mép các ô độ xa, tính bằng R. */
export const RR1_EDGES = [0, 0.6, 1.0, 1.5, 2.5, Infinity];
export const RR2_EDGES = [0, 1.5, 2.5, 4.0, 6.0, Infinity];

function bucket(x: number, edges: number[]): number {
  for (let i = 0; i < edges.length - 1; i++) if (x >= edges[i] && x < edges[i + 1]) return i;
  return edges.length - 2;
}

const label = (edges: number[], i: number) =>
  `${edges[i].toFixed(1)}–${edges[i + 1] === Infinity ? '∞' : edges[i + 1].toFixed(1)}R`;

function pct(a: number, b: number) { return b ? ((a / b) * 100).toFixed(1) + '%' : '—'; }

async function main() {
  console.log(`Tỉ lệ chạm · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến\n`);
  const all: Trade[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      all.push(...runBacktest(symbol, tf, candles, DEFAULT_BT));
    }
  }
  console.log(`${all.length} lệnh.\n`);

  // Nửa đầu để dựng bảng, nửa sau để kiểm tra bảng — không đo bảng trên chính
  // mẫu đã dùng để dựng nó.
  const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
  const cut = Math.floor(sorted.length / 2);
  const inSample = sorted.slice(0, cut);
  const outSample = sorted.slice(cut);

  const table = (ts: Trade[], name: string) => {
    console.log(`── ${name} (n=${ts.length}) ──`);
    console.log('  p(chạm TP1) theo độ xa TP1:');
    const p1: (string | number)[][] = [];
    for (let i = 0; i < RR1_EDGES.length - 1; i++) {
      const cell = ts.filter((t) => t.rr1 != null && bucket(t.rr1, RR1_EDGES) === i);
      const hit = cell.filter((t) => t.hitTP1).length;
      console.log(`    ${label(RR1_EDGES, i).padEnd(12)} n=${String(cell.length).padEnd(6)} ${pct(hit, cell.length)}`);
      p1.push([i, cell.length, cell.length ? hit / cell.length : NaN]);
    }
    console.log('  p(chạm TP2 | đã chạm TP1) theo độ xa TP2:');
    for (let i = 0; i < RR2_EDGES.length - 1; i++) {
      const cell = ts.filter((t) => t.hitTP1 && t.rr2 != null && bucket(t.rr2, RR2_EDGES) === i);
      const hit = cell.filter((t) => t.hitTP2).length;
      console.log(`    ${label(RR2_EDGES, i).padEnd(12)} n=${String(cell.length).padEnd(6)} ${pct(hit, cell.length)}`);
    }
    console.log('  p(chạm TP1) theo hạng:');
    for (const c of ['C', 'B', 'A', 'GOLD'] as const) {
      const cell = ts.filter((t) => t.conviction === c);
      const hit = cell.filter((t) => t.hitTP1).length;
      console.log(`    ${c.padEnd(12)} n=${String(cell.length).padEnd(6)} ${pct(hit, cell.length)}`);
    }
    console.log('');
    return p1;
  };

  table(inSample, 'NỬA ĐẦU — dựng bảng');
  table(outSample, 'NỬA SAU — kiểm tra bảng');
  table(sorted, 'TOÀN MẪU');

  // Bảng dán vào code: đo trên NỬA ĐẦU.
  console.log('── Bảng để dán vào lib/expectancy.ts (đo trên NỬA ĐẦU) ──');
  const p1 = RR1_EDGES.slice(0, -1).map((_, i) => {
    const cell = inSample.filter((t) => t.rr1 != null && bucket(t.rr1, RR1_EDGES) === i);
    return cell.length >= 30 ? cell.filter((t) => t.hitTP1).length / cell.length : null;
  });
  const p2 = RR2_EDGES.slice(0, -1).map((_, i) => {
    const cell = inSample.filter((t) => t.hitTP1 && t.rr2 != null && bucket(t.rr2, RR2_EDGES) === i);
    return cell.length >= 30 ? cell.filter((t) => t.hitTP2).length / cell.length : null;
  });
  console.log(`  P_TP1 = [${p1.map((x) => (x == null ? 'null' : x.toFixed(3))).join(', ')}]`);
  console.log(`  P_TP2 = [${p2.map((x) => (x == null ? 'null' : x.toFixed(3))).join(', ')}]`);
  const base1 = inSample.filter((t) => t.hitTP1).length / inSample.length;
  const tp1s = inSample.filter((t) => t.hitTP1);
  console.log(`  P_TP1_MAC_DINH = ${base1.toFixed(3)}`);
  console.log(`  P_TP2_MAC_DINH = ${(tp1s.filter((t) => t.hitTP2).length / tp1s.length).toFixed(3)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
