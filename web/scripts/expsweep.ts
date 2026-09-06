/**
 * Hiệu chuẩn ngưỡng GATE.minExpectancy.
 *
 *   npx tsx scripts/expsweep.ts --tf 15m,1h,4h --bars 3000
 *
 * Ngưỡng cũ (maxRRBlended = 1.5) đo trên thang 0.5×RR1 + 0.3×RR2, còn bộ mô phỏng
 * trả 0.5/0.5 — hai thang khác nhau, nên con số 1.5 không mang sang được. Phải đo
 * lại từ đầu trên thang kỳ vọng.
 *
 * Chọn ngưỡng theo NỬA ĐẦU, rồi báo cáo nửa sau như một lần kiểm tra. Ngưỡng nào
 * chỉ đẹp ở nửa sau thì đó là may, không phải hiệu chuẩn.
 */
import { DEFAULT_BT, runBacktest, stats, type Trade } from '../lib/backtest';
import { fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

function line(name: string, ts: Trade[], total: number) {
  const s = stats(ts);
  if (!s.trades) { console.log(`  ${pad(name, 16)} (không có lệnh)`); return; }
  console.log(
    `  ${pad(name, 16)} n=${pad(s.trades, 6)} giữ ${pad(num((s.trades / total) * 100, 0) + '%', 6)}` +
    ` win=${pad(num(s.winRate, 1) + '%', 7)} avgR=${pad(num(s.avgR), 7)}` +
    ` tổngR=${pad(num(s.totalR, 1), 8)} PF=${pad(num(s.profitFactor), 6)} DD=${num(s.maxDrawdownR, 1)}`,
  );
}

async function main() {
  const all: Trade[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      all.push(...runBacktest(symbol, tf, candles, DEFAULT_BT));
    }
  }
  const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
  const cut = Math.floor(sorted.length / 2);
  const halves: [string, Trade[]][] = [
    ['NỬA ĐẦU (chọn ngưỡng ở đây)', sorted.slice(0, cut)],
    ['NỬA SAU (kiểm tra)', sorted.slice(cut)],
    ['TOÀN MẪU', sorted],
  ];

  console.log(`${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến · ${sorted.length} lệnh\n`);

  const THRESHOLDS = [-Infinity, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.3];
  for (const [name, ts] of halves) {
    console.log(`── ${name} ──`);
    for (const th of THRESHOLDS) {
      const keep = ts.filter((t) => t.expectancyR != null && t.expectancyR >= th);
      line(th === -Infinity ? 'không cửa' : `kỳ vọng ≥ ${th}`, keep, ts.length);
    }
    console.log('');
  }

  // Kỳ vọng DỰ BÁO có khớp R THỰC HIỆN không? Nếu bảng xác suất đúng thì hai cột
  // này phải bám nhau. Lệch hệ thống nghĩa là mô hình sai, không phải thị trường lạ.
  console.log('── kiểm tra hiệu chuẩn: kỳ vọng dự báo vs R thực hiện ──');
  const EDGES = [-1, -0.15, -0.05, 0.05, 0.15, 0.3, 10];
  for (let i = 0; i < EDGES.length - 1; i++) {
    const cell = sorted.filter((t) => t.expectancyR != null && t.expectancyR >= EDGES[i] && t.expectancyR < EDGES[i + 1]);
    if (!cell.length) continue;
    const duBao = cell.reduce((s, t) => s + (t.expectancyR ?? 0), 0) / cell.length;
    const thuc = cell.reduce((s, t) => s + t.r, 0) / cell.length;
    const pDuBao = cell.reduce((s, t) => s + (t.pWin ?? 0), 0) / cell.length;
    const pThuc = cell.filter((t) => t.r > 0).length / cell.length;
    console.log(
      `  ${pad(`[${EDGES[i]}, ${EDGES[i + 1]})`, 16)} n=${pad(cell.length, 6)}` +
      ` dự báo ${pad(num(duBao, 3), 8)} thực ${pad(num(thuc, 3), 8)}` +
      ` | p thắng dự báo ${pad(num(pDuBao * 100, 0) + '%', 6)} thực ${num(pThuc * 100, 0)}%`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
