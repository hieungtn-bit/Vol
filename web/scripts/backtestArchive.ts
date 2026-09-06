/**
 * Backtest thước mới trên DỮ LIỆU KHO — có taker perp, funding đã chốt, OI.
 *   npm run backtest:archive -- --symbols ENAUSDT --tf 1h --from 2026-07-05 --to 2026-09-05
 */
import { DEFAULT_BT, stats, type Trade } from '../lib/backtest';
import { runBacktestNew, type PointInTimeDeriv } from '../lib/backtestNew';
import { archiveFunding, archiveKlines, archiveManifest, archiveOI, asOfRow } from '../lib/archive';
import { barDelta } from '../lib/deltaDiv';
import { SCORE_FLOOR } from '../lib/confluence';
import type { OIInfo, TF } from '../lib/types';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,SOLUSDT,ENAUSDT') as string).split(',');
const tfs = (arg('tf', '1h,4h') as string).split(',') as TF[];
const from = arg('from', '2026-07-05')!;
const to = arg('to', '2026-09-05')!;
const floor = arg('floor') != null ? Number(arg('floor')) : undefined;

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const months = (a: string, b: string) => {
  const out: string[] = [];
  const d = new Date(a + 'T00:00:00Z');
  while (d <= new Date(b + 'T00:00:00Z')) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return [...new Set(out)];
};

function row(name: string, t: Trade[]) {
  const s = stats(t);
  if (!s.trades) { console.log(`  ${pad(name, 26)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 26)} n=${pad(s.trades, 5)} win=${pad(num(s.winRate, 1) + '%', 7)}`
    + ` avgR=${pad(num(s.avgR), 7)} tổngR=${pad(num(s.totalR, 1), 8)}`
    + ` PF=${pad(num(s.profitFactor), 6)} DD(R)=${pad(num(s.maxDrawdownR, 1), 7)}`
    + ` TP1=${num(s.tp1Rate, 0)}% TP2=${num(s.tp2Rate, 0)}%`,
  );
}

async function main() {
  console.log(`Backtest THƯỚC MỚI · DỮ LIỆU KHO · ${symbols.join(', ')} · ${tfs.join(', ')} · ${from} → ${to}`);
  console.log(floor != null ? `⚠ SÀN HẠ XUỐNG ${floor} — chỉ chẩn đoán` : `Sàn điểm ${SCORE_FLOOR} — đúng cấu hình chạy thật`);

  const all: Trade[] = [];
  const blockers = new Map<string, number>();
  let bars = 0; let signals = 0;

  console.log('\n── TIỀN KIỂM TRA ĐỘ PHỦ ──');
  const data: Record<string, { c15: ReturnType<typeof archiveKlines>; derivAt: (t: number) => PointInTimeDeriv | null }> = {};

  for (const symbol of symbols) {
    const perp15 = archiveKlines('um', symbol, '15m', from, to);
    const spot15 = archiveKlines('spot', symbol, '15m', from, to);
    const fund = archiveFunding(symbol, months(from, to));
    const oi = archiveOI(symbol, from, to);

    const perpByT = new Map(perp15.map((c) => [c.t, c]));
    const spotByT = new Map(spot15.map((c) => [c.t, c]));
    const gaps = perp15.filter((c, i) => i > 0 && c.t - perp15[i - 1].t !== 900_000).length;
    const dup = perp15.length - new Set(perp15.map((c) => c.t)).size;
    const takerCov = perp15.filter((c) => c.takerBuyBase != null).length / Math.max(1, perp15.length);

    console.log(
      `  ${pad(symbol, 10)} perp15=${pad(perp15.length, 6)} spot15=${pad(spot15.length, 6)}`
      + ` funding=${pad(fund.length, 5)}(${fund[0]?.intervalHours ?? '?'}h) OI=${pad(oi.length, 6)}`
      + ` · taker ${num(takerCov * 100, 1)}% · khoảng trống ${gaps} · trùng ${dup}`,
    );
    if (!perp15.length) continue;

    const derivAt = (at: number): PointInTimeDeriv | null => {
      const f = asOfRow(fund, at);
      const o = asOfRow(oi, at);
      // Delta của nến 15m ĐÃ ĐÓNG gần nhất, trên cả hai chợ, CÙNG một mốc.
      const barT = Math.floor(at / 900_000) * 900_000 - 900_000;
      const dp = perpByT.get(barT); const ds = spotByT.get(barT);
      const dPerp = dp ? barDelta(dp) : null;
      const dSpot = ds ? barDelta(ds) : null;
      const oiInfo: OIInfo = o
        ? { quality: 'REAL', venue: 'binance-perp', open: o.oi, unit: 'base coin',
            chg1h: null, chg24h: null, read: 'flat', squeezeWarning: false, oiOverVol: null,
            note: `OI kho ${new Date(o.t).toISOString()}` }
        : { quality: 'UNAVAILABLE', venue: null, open: null, unit: null, chg1h: null,
            chg24h: null, read: 'na', squeezeWarning: false, oiOverVol: null, note: 'N/A' };
      return {
        hasPerpTaker: dPerp != null,
        hasFunding: f != null,
        spotPerpAgree: dPerp != null && dSpot != null && dPerp !== 0 && Math.sign(dPerp) === Math.sign(dSpot),
        // Funding của kho là rate cho CHU KỲ của chính nó. Quy về mức 8h để so
        // với thang ngưỡng vốn đặt theo 8h — ENA chốt 4h nên không quy đổi thì
        // mọi mức đều bị đánh giá nhẹ đi một nửa.
        fundingRate: f ? f.rate * (8 / (f.intervalHours || 8)) : null,
        oi: oiInfo,
      };
    };
    data[symbol] = { c15: perp15, derivAt };
  }

  console.log('\n── TRẦN ĐIỂM KHẢ DỤNG ──');
  const anyPerp = Object.values(data).some((d) => d.c15.some((c) => c.takerBuyBase != null));
  const ceiling = 2 + 2 + 1.5 + 1 + (anyPerp ? 1 : 0) + (Object.keys(data).length ? 0.5 : 0);
  console.log(`  trần = ${ceiling.toFixed(1)} · sàn = ${floor ?? SCORE_FLOOR}`
    + (ceiling >= (floor ?? SCORE_FLOOR) ? ' → CÓ THỂ kiểm chứng' : ' → KHÔNG THỂ kiểm chứng, chỉ chạy chẩn đoán'));

  for (const symbol of Object.keys(data)) {
    for (const tf of tfs) {
      const r = runBacktestNew(symbol, tf, data[symbol].c15, DEFAULT_BT, 1000, floor, data[symbol].derivAt);
      bars += r.bars; signals += r.signals;
      for (const b of r.blockers) blockers.set(b.reason, (blockers.get(b.reason) ?? 0) + b.n);
      row(`${symbol} ${tf}`, r.trades);
      all.push(...r.trades);
    }
  }

  console.log('\n── TỔNG ──');
  row('tất cả', all);
  if (all.length) {
    const gross = all.reduce((s, t) => s + t.rGross, 0);
    const cost = all.reduce((s, t) => s + t.costR, 0);
    console.log(`  ${pad('', 26)} R TRƯỚC phí ${num(gross, 1)} · phí ${num(cost, 1)} (${num(cost / all.length, 3)}/lệnh) · R SAU phí ${num(gross - cost, 1)}`);
    console.log(`  ${pad('', 26)} avgR và PF ở trên đều tính trên R SAU phí. DD tính bằng R, ghép chuỗi theo thứ tự thời gian tín hiệu.`);
    const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
    console.log('\n── theo khung ──');
    for (const tf of tfs) row(tf, all.filter((t) => t.tf === tf));
    console.log('\n── theo hướng ──');
    row('mở mua', all.filter((t) => t.side === 'LONG'));
    row('mở bán', all.filter((t) => t.side === 'SHORT'));
    console.log('\n── theo khổ lệnh ──');
    row('khổ đủ', all.filter((t) => t.conviction === 'A'));
    row('khổ nửa', all.filter((t) => t.conviction === 'B'));
    console.log('\n── kiểu thoát lệnh ──');
    const byExit = new Map<string, Trade[]>();
    for (const t of all) byExit.set(t.exitReason, [...(byExit.get(t.exitReason) ?? []), t]);
    for (const [k, v] of [...byExit].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${pad(k, 26)} n=${pad(v.length, 5)} avgR=${num(v.reduce((s, t) => s + t.r, 0) / v.length)}`);
    }
    console.log(`\n  nửa đầu / nửa sau theo thời gian:`);
    row('  nửa đầu', sorted.slice(0, Math.floor(sorted.length / 2)));
    row('  nửa sau', sorted.slice(Math.floor(sorted.length / 2)));
  }

  console.log(`\n── TỶ LỆ RA LỆNH ──\n  xét ${bars} nến · ra kế hoạch ${signals} (${num((signals / Math.max(1, bars)) * 100, 2)}%)`);
  console.log('\n── LÝ DO ĐỨNG NGOÀI (đếm ĐỘC LẬP, một nến có thể trúng nhiều lý do) ──');
  for (const [reason, n] of [...blockers].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(reason, 34)} ${pad(n, 7)} (${num((n / Math.max(1, bars)) * 100, 1)}%)`);
  }
  console.log(`\n── MANIFEST DỮ LIỆU (${archiveManifest().length} tệp) ──`);
  for (const m of archiveManifest().slice(0, 4)) console.log(`  ${m.sha256} ${pad(m.rows, 7)} dòng  ${m.url.replace('https://data.binance.vision/data/', '')}`);
  console.log(`  … tổng ${archiveManifest().length} tệp, ${archiveManifest().reduce((s, m) => s + m.rows, 0)} dòng`);
}
main().catch((e) => { console.error(e); process.exit(1); });
