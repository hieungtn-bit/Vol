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
    { name: 'nhất trí + kỳ vọng > 0', ok: (t) => t.unanimous && (t.expectancyR ?? -1) > 0 },
    { name: 'nhất trí + ≥B + kỳ vọng > 0', ok: (t) => t.unanimous && RANKN[t.conviction] >= 1 && (t.expectancyR ?? -1) > 0 },
    { name: '≥B + kỳ vọng > 0', ok: (t) => RANKN[t.conviction] >= 1 && (t.expectancyR ?? -1) > 0 },
    { name: 'CỬA ĐẦY ĐỦ (4 điều kiện)', ok: (t) => t.unanimous && RANKN[t.conviction] >= 1 && (t.expectancyR ?? -1) > 0 && t.slPct >= 1.2 },
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
  const best = { name: 'CỬA ĐẦY ĐỦ (4 điều kiện)', ok: (t: Trade) => t.unanimous && RANKN[t.conviction] >= 1 && (t.expectancyR ?? -1) > 0 && t.slPct >= 1.2 };
  const kept = all.filter(best.ok);
  console.log(`\n  ["${best.name}" bẻ ra theo khung và theo mã]`);
  for (const tf of tfs) row(`  ${tf}`, kept.filter((t) => t.tf === tf));
  for (const sym of symbols) row(`  ${sym}`, kept.filter((t) => t.symbol === sym));
  row('  LONG', kept.filter((t) => t.side === 'LONG'));
  row('  SHORT', kept.filter((t) => t.side === 'SHORT'));

  // SL hẹp lỗ vì PHÍ hay vì kèo tồi? Phí tính theo R tỉ lệ nghịch với độ rộng
  // stop, nên phải tách gộp/ròng ra mới trả lời được — và câu trả lời quyết định
  // luật này có bền hay không.
  console.log('\n── ĐỘ RỘNG STOP: GỘP vs RÒNG (phí có phải là lý do không?) ──');
  for (const [lo, hi] of [[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 999]]) {
    const g = all.filter((t) => t.slPct >= lo && t.slPct < hi);
    if (!g.length) continue;
    const gross = g.reduce((s, t) => s + t.rGross, 0) / g.length;
    const cost = g.reduce((s, t) => s + t.costR, 0) / g.length;
    const net = g.reduce((s, t) => s + t.r, 0) / g.length;
    console.log(`  ${pad(`${lo}–${hi}%`, 12)} n=${pad(g.length, 5)} gộp=${pad(num(gross), 7)} phí=${pad(num(cost, 3), 7)} ròng=${num(net)}`);
  }

  console.log('\n── "cửa đầy đủ + SL ≥ 1.5%" bẻ ra theo khung và mã ──');
  const R2: Record<Conviction, number> = { C: 0, B: 1, A: 2, GOLD: 3 };
  const win = all.filter((t) => R2[t.conviction] >= 1 && (t.expectancyR ?? -1) > 0 && t.slPct >= 1.5);
  for (const tf of tfs) row(`  ${tf}`, win.filter((t) => t.tf === tf));
  for (const sym of symbols) row(`  ${sym}`, win.filter((t) => t.symbol === sym));
  row('  LONG', win.filter((t) => t.side === 'LONG'));
  row('  SHORT', win.filter((t) => t.side === 'SHORT'));

  if (arg('variants', '1') !== '0') {
    console.log('\n── SO BIẾN THỂ (cùng dữ liệu, chỉ đổi một luật mỗi lần) ──');
    console.log('  Cột "ngoài mẫu" là nửa sau theo thời gian — phần chưa dùng để chỉnh gì.');
    const G = { minConviction: 'B' as const, maxRRBlended: 1.5, valueMigration: false };
    const variants: { name: string; opt: Partial<BTOptions> }[] = [
      { name: 'gốc (không cửa nào)', opt: { valueMigration: false } },
      { name: 'cửa cũ: nhất trí+≥B+Rkv≤1.5', opt: { ...G } },
      { name: 'CỬA MỚI: + phí ≤ 10% của 1R', opt: { ...G, minSLPct: 1.2 } },
      { name: 'cửa mới, ngưỡng phí 8% (SL≥1.5%)', opt: { ...G, minSLPct: 1.5 } },
      { name: 'cắt value dời chỗ (đo riêng)', opt: { valueMigration: true } },
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
