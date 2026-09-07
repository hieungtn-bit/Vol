/**
 * Chẩn đoán BỘ DỰNG MỨC GIÁ.
 *
 *   npx tsx scripts/levels.ts --tf 15m,1h,4h --bars 3000
 *
 * Câu hỏi: kế hoạch mà hệ dựng ra có bao giờ KHÔNG THỂ có lãi ngay từ lúc dựng
 * không — tức mục tiêu đặt gần hơn cả chi phí vào-ra?
 */
import { DEFAULT_BT, BT_WINDOW, signalAt } from '../lib/backtest';
import { FEES } from '../lib/direct';
import { fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

/** Chi phí vòng vào-ra tính theo % giá. Mục tiêu gần hơn mức này là bất khả thi. */
const COST_PCT = (FEES.perSide * 2 + FEES.slip) * 100;

async function main() {
  console.log(`Chẩn đoán mức giá · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến`);
  console.log(`Chi phí vòng vào-ra = ${COST_PCT.toFixed(3)}% giá\n`);

  const rows: {
    tf: TF; rr1: number; rr2: number; slPct: number; tp1Pct: number;
    nodeOverAtr: number; tradeable: boolean;
  }[] = [];

  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      const w = BT_WINDOW[tf];
      for (let i = w; i < candles.length - 2; i++) {
        const c = signalAt(symbol, tf, candles, i, w, null, DEFAULT_BT.valueMigration, null);
        if (!c || c.rr1 == null || c.rr2 == null) continue;
        const long = c.side === 'LONG';
        const eRef = long ? c.entry[1] : c.entry[0];
        if (!(eRef > 0)) continue;
        rows.push({
          tf,
          rr1: c.rr1, rr2: c.rr2,
          slPct: (Math.abs(eRef - c.sl) / eRef) * 100,
          tp1Pct: (Math.abs(c.tp1 - eRef) / eRef) * 100,
          nodeOverAtr: (c.entry[1] - c.entry[0]) / eRef * 100,
          tradeable: c.tradeable,
        });
      }
    }
  }

  console.log(`${rows.length} tín hiệu.\n`);

  // 1. TP1 có gần hơn chi phí không?
  const dead = rows.filter((r) => r.tp1Pct < COST_PCT);
  const deadNet = rows.filter((r) => r.tp1Pct < COST_PCT * 2);
  console.log('── MỤC TIÊU BẤT KHẢ THI NGAY TỪ LÚC DỰNG ──');
  console.log(`  TP1 gần hơn chi phí vào-ra (${COST_PCT.toFixed(3)}%): ${dead.length} (${pct(dead.length, rows.length)})`);
  console.log(`  TP1 gần hơn 2× chi phí:                    ${deadNet.length} (${pct(deadNet.length, rows.length)})`);
  console.log(`  trong số đó có ${dead.filter((r) => r.tradeable).length} kèo VẪN QUA CỬA\n`);

  // 2. Phân bố rr1
  console.log('── PHÂN BỐ RR TP1 ──');
  const E = [0, 0.15, 0.3, 0.5, 0.8, 1.2, 2, 99];
  for (let i = 0; i < E.length - 1; i++) {
    const c = rows.filter((r) => r.rr1 >= E[i] && r.rr1 < E[i + 1]);
    if (!c.length) continue;
    const avgTp1 = c.reduce((s, r) => s + r.tp1Pct, 0) / c.length;
    console.log(
      `  rr1 ${pad(`${E[i]}–${E[i + 1] === 99 ? '∞' : E[i + 1]}`, 9)} n=${pad(c.length, 6)} ${pad(pct(c.length, rows.length), 7)}` +
      ` TP1 cách ${pad(num(avgTp1, 3) + '%', 8)} SL cách ${pad(num(c.reduce((s, r) => s + r.slPct, 0) / c.length, 3) + '%', 8)}` +
      ` · qua cửa ${pct(c.filter((r) => r.tradeable).length, c.length)}`,
    );
  }

  // 3. Vùng entry rộng bao nhiêu so với stop — nghi phạm chính
  console.log('\n── BỀ RỘNG VÙNG ENTRY (nó nằm TRONG mẫu số của R) ──');
  for (const tf of tfs) {
    const c = rows.filter((r) => r.tf === tf);
    if (!c.length) continue;
    const share = c.map((r) => r.nodeOverAtr / Math.max(r.slPct, 1e-9));
    share.sort((a, b) => a - b);
    const q = (p: number) => share[Math.floor(share.length * p)];
    console.log(
      `  ${pad(tf, 5)} n=${pad(c.length, 6)} vùng entry chiếm bao nhiêu phần của stop:` +
      ` trung vị ${num(q(0.5) * 100, 0)}% · 75% ${num(q(0.75) * 100, 0)}% · 90% ${num(q(0.9) * 100, 0)}%`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
