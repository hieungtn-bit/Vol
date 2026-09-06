/**
 * Sinh tệp REPLAY từ backtest lịch sử trên dữ liệu kho.
 * Đây là LỆNH ĐÃ XẢY RA trong quá khứ, dùng để chứng minh luồng hiển thị chạy —
 * không bao giờ được trộn với tín hiệu hiện tại.
 *   npx tsx scripts/makeReplay.ts --from 2026-08-20 --to 2026-09-05
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { DEFAULT_BT } from '../lib/backtest';
import { runBacktestNew, type PointInTimeDeriv } from '../lib/backtestNew';
import { archiveFunding, archiveKlines, archiveOI, asOfRow } from '../lib/archive';
import { barDelta } from '../lib/deltaDiv';
import type { OIInfo, TF } from '../lib/types';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,SOLUSDT,ENAUSDT') as string).split(',');
const from = arg('from', '2026-08-20')!; const to = arg('to', '2026-09-05')!;
const months = (a: string, b: string) => { const o: string[] = []; const d = new Date(a + 'T00:00:00Z');
  while (d <= new Date(b + 'T00:00:00Z')) { o.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); } return [...new Set(o)]; };

const rows: any[] = [];
for (const symbol of symbols) {
  const perp15 = archiveKlines('um', symbol, '15m', from, to);
  const spot15 = archiveKlines('spot', symbol, '15m', from, to);
  if (!perp15.length) continue;
  const fund = archiveFunding(symbol, months(from, to));
  const oi = archiveOI(symbol, from, to);
  const perpByT = new Map(perp15.map((c) => [c.t, c]));
  const spotByT = new Map(spot15.map((c) => [c.t, c]));
  const derivAt = (at: number): PointInTimeDeriv => {
    const f = asOfRow(fund, at); const o = asOfRow(oi, at);
    const barT = Math.floor(at / 900_000) * 900_000 - 900_000;
    const dp = perpByT.get(barT); const ds = spotByT.get(barT);
    const dPerp = dp ? barDelta(dp) : null; const dSpot = ds ? barDelta(ds) : null;
    const oiInfo: OIInfo = o
      ? { quality: 'REAL', venue: 'binance-perp', open: o.oi, unit: 'base coin', chg1h: null, chg24h: null,
          read: 'flat', squeezeWarning: false, oiOverVol: null, note: 'kho' }
      : { quality: 'UNAVAILABLE', venue: null, open: null, unit: null, chg1h: null, chg24h: null,
          read: 'na', squeezeWarning: false, oiOverVol: null, note: 'N/A' };
    return {
      hasPerpTaker: dPerp != null, hasFunding: f != null,
      spotPerpAgree: dPerp != null && dSpot != null && dPerp !== 0 && Math.sign(dPerp) === Math.sign(dSpot),
      fundingRate: f ? f.rate * (8 / (f.intervalHours || 8)) : null, oi: oiInfo,
    };
  };
  for (const tf of ['1h'] as TF[]) {
    const r = runBacktestNew(symbol, tf, perp15, DEFAULT_BT, 1000, undefined, derivAt);
    for (const t of r.trades) {
      rows.push({
        symbol: t.symbol, tf: t.tf, side: t.side === 'LONG' ? 'mua' : 'ban',
        signalTime: t.signalTime, score: t.net,
        entry: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2,
        exitReason: t.exitReason, r: Math.round(t.r * 100) / 100,
        rGross: Math.round(t.rGross * 100) / 100, costR: Math.round(t.costR * 10000) / 10000,
      });
    }
  }
}
rows.sort((a, b) => b.signalTime - a.signalTime);
mkdirSync('public', { recursive: true });
const out = { kind: 'REPLAY', from, to, generatedAt: Date.now(), note: 'Lệnh ĐÃ XẢY RA trong quá khứ trên dữ liệu kho Binance. Không phải tín hiệu hiện tại.', trades: rows };
writeFileSync('public/replay.json', JSON.stringify(out, null, 1));
console.log(`REPLAY: ${rows.length} lệnh · ${from} → ${to} · public/replay.json`);
