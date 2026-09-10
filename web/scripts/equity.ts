/**
 * 1000 USDT SẼ RA SAO — câu mà avgR không trả lời được.
 *
 *   npx tsx scripts/equity.ts --tf 15m,1h,4h --bars 3000
 *
 * Chạy chuỗi lệnh ĐÃ QUA CỬA trên một tài khoản thật, rủi ro cố định theo % vốn
 * hiện tại — đúng cách bảng vào tiền tính khối lượng.
 *
 * Quét nhiều mức rủi ro và nhiều trần số lệnh mở cùng lúc, vì hai tham số đó đổi
 * kết quả nhiều hơn bất cứ thứ gì trong thuật toán.
 */
import { DEFAULT_BT, runBacktest, stats, type Trade } from '../lib/backtest';
import { runEquity } from '../lib/equity';
import { nenDai, ngay as ngayISO, soNenChoNam } from './nendai';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const nam = Number(arg('nam', '0'));
const bars = Number(arg('bars', '3000'));

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

async function main() {
  console.log(`Tài khoản thật · ${symbols.join(',')} · ${tfs.join(',')} · ${nam > 0 ? nam + ' năm' : bars + ' nến'}`);

  const all: Trade[] = [];
  let t0 = Infinity, t1 = 0;
  for (const tf of tfs) {
    const soNen = nam > 0 ? soNenChoNam(tf, nam) : bars;
    for (const symbol of symbols) {
      const { nen, pv } = await nenDai(symbol, tf, soNen);
      if (nen.length < 200) continue;
      if (pv.tu) t0 = Math.min(t0, pv.tu);
      t1 = Math.max(t1, pv.den);
      all.push(...runBacktest(symbol, tf, nen, DEFAULT_BT));
      process.stdout.write(pv.nguon === 'đĩa' ? '·' : '+');
    }
  }
  console.log(`\nMẫu: ${ngayISO(t0)} → ${ngayISO(t1)} · ${((t1 - t0) / 86_400_000).toFixed(0)} ngày`);

  const qua = all.filter((t) => t.tradeable).sort((a, b) => a.signalTime - b.signalTime);
  const s = stats(qua);
  const ngay = (qua[qua.length - 1].signalTime - qua[0].signalTime) / 86_400_000;
  console.log(`\n${qua.length} kèo qua cửa trên ${num(ngay, 0)} ngày · avgR ${num(s.avgR)} · PF ${num(s.profitFactor)}\n`);

  console.log('══ VỐN 1000 USDT ══');
  console.log(`  ${pad('rủi ro', 8)} ${pad('trần', 6)} ${pad('lệnh', 6)} ${pad('bỏ', 5)} ${pad('cuối kỳ', 10)} ${pad('lãi', 9)} ${pad('sụt sâu nhất', 14)} ${pad('đáy', 9)} ${pad('chìm', 8)} thua liên tiếp`);
  for (const riskPct of [0.5, 1, 2, 3, 5]) {
    for (const maxConcurrent of [3]) {
      const e = runEquity(qua, { equity: 1000, riskPct, maxConcurrent });
      console.log(
        `  ${pad(riskPct + '%', 8)} ${pad(maxConcurrent, 6)} ${pad(e.trades, 6)} ${pad(e.skippedFull, 5)}` +
        ` ${pad(num(e.end, 0), 10)} ${pad(num(e.returnPct, 1) + '%', 9)}` +
        ` ${pad('−' + num(e.maxDrawdownPct, 1) + '%', 14)} ${pad(num(e.troughEquity, 0), 9)}` +
        ` ${pad(num(e.longestUnderwaterDays, 0) + 'ng', 8)} ${e.longestLossStreak}`,
      );
    }
  }

  console.log('\n── đổi trần số lệnh mở cùng lúc (rủi ro 1%) ──');
  console.log(`  ${pad('trần', 6)} ${pad('lệnh', 6)} ${pad('bỏ', 5)} ${pad('cuối kỳ', 10)} ${pad('lãi', 9)} ${pad('sụt sâu nhất', 14)} thua liên tiếp`);
  for (const maxConcurrent of [1, 2, 3, 5, 99]) {
    const e = runEquity(qua, { equity: 1000, riskPct: 1, maxConcurrent });
    console.log(
      `  ${pad(maxConcurrent === 99 ? 'không' : maxConcurrent, 6)} ${pad(e.trades, 6)} ${pad(e.skippedFull, 5)}` +
      ` ${pad(num(e.end, 0), 10)} ${pad(num(e.returnPct, 1) + '%', 9)} ${pad('−' + num(e.maxDrawdownPct, 1) + '%', 14)} ${e.longestLossStreak}`,
    );
  }

  // Nửa sau theo thời gian — phần chưa dùng để chỉnh gì.
  const cut = Math.floor(qua.length / 2);
  console.log('\n── chỉ nửa sau mẫu (ngoài mẫu), rủi ro 1%, trần 3 ──');
  const e2 = runEquity(qua.slice(cut), { equity: 1000, riskPct: 1, maxConcurrent: 3 });
  console.log(
    `  ${e2.trades} lệnh · cuối kỳ ${num(e2.end, 0)} · lãi ${num(e2.returnPct, 1)}%` +
    ` · sụt sâu nhất −${num(e2.maxDrawdownPct, 1)}% · thua liên tiếp ${e2.longestLossStreak}`,
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
