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
import { DEFAULT_BT, calibrate, evidenceEdge, goldDiagnostics, runBacktest, stats, type BTOptions, type Trade } from '../lib/backtest';
import { fetchKlinesHistory } from '../lib/sources';
import type { Conviction, Weights } from '../lib/direct';
import type { Candle, TF } from '../lib/types';

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

  // Tải một lần, dùng lại cho mọi biến thể — nếu mỗi biến thể tải lại dữ liệu thì
  // vừa chậm vừa có nguy cơ so hai bộ nến khác nhau.
  const data = new Map<string, Candle[]>();
  const all: Trade[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      data.set(`${symbol}|${tf}`, candles);
      if (candles.length < 200) { console.log(`  ${symbol} ${tf}: chỉ ${candles.length} nến, bỏ qua`); continue; }
      if (arg('diag') !== undefined) {
        const g = goldDiagnostics(symbol, tf, candles);
        console.log(`  ${pad(symbol + ' ' + tf, 22)} ${g.signals} tín hiệu · ${g.golden} đạt vàng (${num((g.golden / Math.max(1, g.signals)) * 100, 2)}%)`);
        for (const b of g.blockers) console.log(`  ${pad('', 22)} chặn bởi "${pad(b.reason, 22)}" ${pad(b.n, 6)} (${num(b.pct, 1)}%)`);
      }
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
  const gross = all.reduce((s, t) => s + t.rGross, 0);
  const cost = all.reduce((s, t) => s + t.costR, 0);
  console.log(`  ${pad('', 22)} trước phí ${num(gross, 1)}R · phí ${num(cost, 1)}R (${num(cost / all.length, 3)}R mỗi lệnh) · sau phí ${num(gross - cost, 1)}R`);

  // Tách theo THỜI GIAN. Mọi "cải thiện" chỉ đo trên toàn bộ mẫu đều có nguy cơ là
  // uốn tham số theo dữ liệu. Nửa sau là phần chưa dùng để chỉnh gì cả.
  const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
  const cut = Math.floor(sorted.length / 2);
  console.log('\n── tách theo thời gian (nửa sau là ngoài mẫu) ──');
  row('nửa đầu', sorted.slice(0, cut));
  row('nửa sau', sorted.slice(cut));

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

  console.log('\n── HIỆU CHUẨN NGƯỠNG BẰNG DỮ LIỆU ──');
  let lastDim = '';
  for (const c of calibrate(all)) {
    if (c.dim !== lastDim) { console.log(`  [${c.dim}]`); lastDim = c.dim; }
    console.log(`    ${pad(c.bucket, 22)} n=${pad(c.n, 6)} avgR=${pad(num(c.avgR), 7)} PF=${num(c.pf)}`);
  }

  // LUẬT CHỌN LỆNH: đo trên chính bộ lệnh vừa chạy. Không cần chạy lại vì các luật
  // này chỉ quyết định NHẬN hay BỎ một tín hiệu, không đổi hướng cũng không đổi mức giá.
  console.log('\n── LUẬT CHỌN LỆNH (đo trên cùng bộ lệnh) ──');
  const RANKN: Record<Conviction, number> = { C: 0, B: 1, A: 2, GOLD: 3 };
  const rules: { name: string; ok: (t: Trade) => boolean }[] = [
    { name: 'tất cả (gốc)', ok: () => true },
    { name: 'nhất trí (không vế nào ngược)', ok: (t) => t.unanimous },
    { name: 'hạng ≥ B', ok: (t) => RANKN[t.conviction] >= 1 },
    { name: 'hạng ≥ A', ok: (t) => RANKN[t.conviction] >= 2 },
    { name: 'nhất trí + hạng ≥ B', ok: (t) => t.unanimous && RANKN[t.conviction] >= 1 },
    { name: 'nhất trí HOẶC hạng ≥ A', ok: (t) => t.unanimous || RANKN[t.conviction] >= 2 },
    { name: 'nhất trí + Rkv ≤ 1.5', ok: (t) => t.unanimous && (t.rrBlended ?? 0) <= 1.5 },
    { name: 'nhất trí + ≥B + Rkv ≤ 1.5', ok: (t) => t.unanimous && RANKN[t.conviction] >= 1 && (t.rrBlended ?? 0) <= 1.5 },
    { name: '≥B + Rkv ≤ 1.5', ok: (t) => RANKN[t.conviction] >= 1 && (t.rrBlended ?? 0) <= 1.5 },
  ];
  for (const r of rules) {
    const kept = all.filter(r.ok);
    const k = [...kept].sort((a, b) => a.signalTime - b.signalTime);
    const a = stats(kept);
    const oos = stats(k.slice(Math.floor(k.length / 2)));
    console.log(
      `  ${pad(r.name, 32)} n=${pad(a.trades, 5)} (${pad(num((a.trades / all.length) * 100, 0) + '%', 5)})` +
      ` avgR=${pad(num(a.avgR), 7)} tổngR=${pad(num(a.totalR, 1), 8)} PF=${pad(num(a.profitFactor), 6)} DD=${pad(num(a.maxDrawdownR, 1), 7)}` +
      ` | ngoài mẫu avgR=${pad(num(oos.avgR), 7)} PF=${num(oos.profitFactor)}`,
    );
  }

  // Luật thắng cuộc bẻ ra theo khung và theo mã: một luật chỉ đáng tin khi nó
  // không sống nhờ đúng một khung hoặc đúng một mã.
  const best = { name: 'nhất trí + ≥B + Rkv ≤ 1.5', ok: (t: Trade) => t.unanimous && RANKN[t.conviction] >= 1 && (t.rrBlended ?? 0) <= 1.5 };
  const kept = all.filter(best.ok);
  console.log(`\n  ["${best.name}" bẻ ra theo khung và theo mã]`);
  for (const tf of tfs) row(`  ${tf}`, kept.filter((t) => t.tf === tf));
  for (const sym of symbols) row(`  ${sym}`, kept.filter((t) => t.symbol === sym));
  row('  LONG', kept.filter((t) => t.side === 'LONG'));
  row('  SHORT', kept.filter((t) => t.side === 'SHORT'));

  if (arg('variants', '1') !== '0') {
    console.log('\n── SO BIẾN THỂ (cùng dữ liệu, chỉ đổi một luật mỗi lần) ──');
    console.log('  Cột "ngoài mẫu" là nửa sau theo thời gian — phần chưa dùng để chỉnh gì.');
    const WSETS: Record<string, Weights> = {
      // tổng luôn = 103 để ngưỡng hạng còn so sánh được
      'VA nhẹ, cấu trúc + taker nặng': { structure: 30, valueLocation: 10, takerFlow: 25, priceAction: 20, openInterest: 10, funding: 8 },
      'bỏ hẳn vế Value Area': { structure: 32, valueLocation: 0, takerFlow: 26, priceAction: 23, openInterest: 14, funding: 8 },
    };
    const variants: { name: string; opt: Partial<BTOptions> }[] = [
      { name: 'gốc', opt: {} },
      { name: 'trọng số: VA nhẹ', opt: { weights: WSETS['VA nhẹ, cấu trúc + taker nặng'] } },
      { name: 'trọng số: bỏ hẳn VA', opt: { weights: WSETS['bỏ hẳn vế Value Area'] } },
      { name: 'VA nhẹ + ≥B', opt: { weights: WSETS['VA nhẹ, cấu trúc + taker nặng'], minConviction: 'B' } },
      { name: 'bỏ VA + ≥B', opt: { weights: WSETS['bỏ hẳn vế Value Area'], minConviction: 'B' } },
      { name: '≥B (trọng số gốc)', opt: { minConviction: 'B' } },
      { name: '≥B + Rkv≤1.5 (trọng số gốc)', opt: { minConviction: 'B', maxRRBlended: 1.5 } },
    ];
    for (const v of variants) {
      const opt: BTOptions = { ...DEFAULT_BT, minConviction, ...v.opt };
      const t: Trade[] = [];
      for (const tf of tfs) {
        for (const symbol of symbols) {
          const cs = data.get(`${symbol}|${tf}`);
          if (!cs || cs.length < 200) continue;
          t.push(...runBacktest(symbol, tf, cs, opt));
        }
      }
      const s2 = [...t].sort((a, b) => a.signalTime - b.signalTime);
      const oos = stats(s2.slice(Math.floor(s2.length / 2)));
      const a = stats(t);
      console.log(
        `  ${pad(v.name, 38)} n=${pad(a.trades, 5)} avgR=${pad(num(a.avgR), 7)} tổngR=${pad(num(a.totalR, 1), 8)}` +
        ` PF=${pad(num(a.profitFactor), 6)} DD=${pad(num(a.maxDrawdownR, 1), 7)}` +
        ` | ngoài mẫu n=${pad(oos.trades, 5)} avgR=${pad(num(oos.avgR), 7)} PF=${num(oos.profitFactor)}`,
      );
    }
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
