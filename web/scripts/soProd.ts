/**
 * SO JSON PRODUCTION VỚI MÁY TRẠNG THÁI.
 *
 *   npx tsx scripts/soProd.ts                       # so với scan.maix8.study
 *   npx tsx scripts/soProd.ts --url http://localhost:3000 --symbols ENAUSDT
 *
 * Đọc /api/scan của một bản đang chạy rồi, VỚI MỖI THẺ, tự dựng lại trạng thái
 * từ chính con số bản đó in ra. In bảng: bản kia nói gì / máy trạng thái nói gì.
 *
 * Không sửa gì, không deploy gì. Chỉ đọc.
 */
import { evaluate, type LifecycleInput } from '../lib/lifecycle';
import { TFS, type TF } from '../lib/types';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL_ = arg('url', 'https://scan.maix8.study');
const SYMS = (arg('symbols', 'ENAUSDT') as string);

const pad = (x: unknown, n: number) => String(x).padEnd(n);
const num = (x: unknown) => (typeof x === 'number' ? x : NaN);

interface TheJson {
  side?: string; bias?: string;
  entry?: [number, number] | null;
  sl?: number | null; tp1?: number | null; tp2?: number | null;
  trigger?: string; triggerLevel?: number | null;
  rrBlended?: number | null; rr1?: number | null; rr2?: number | null;
  tradeable?: boolean;
  conviction?: string;
  lifecycle?: { state: string; banner: string } | null;
}

/** Dựng LifecycleInput từ đúng những gì JSON có. Thiếu thì để null, không đoán. */
function tuJson(symbol: string, tf: TF, t: TheJson, last: number): LifecycleInput | null {
  const side = (t.side ?? t.bias) as 'LONG' | 'SHORT' | 'WAIT' | undefined;
  if (!side || side === 'WAIT' || !t.entry || t.sl == null || t.tp1 == null || t.tp2 == null) return null;
  const rr = t.rrBlended ?? (t.rr1 != null && t.rr2 != null ? 0.5 * t.rr1 + 0.3 * t.rr2 : null);
  return {
    symbol, tf, side,
    entryLow: t.entry[0], entryHigh: t.entry[1],
    sl: t.sl, tp1: t.tp1, tp2: t.tp2,
    triggerText: t.trigger ?? '', triggerLevel: t.triggerLevel ?? null,
    last, ts: Date.now(),
    // JSON không mang nến — để null thì H1/H4/H8/H10 không bắt, nên bảng này chỉ
    // kết luận được các cổng tính từ GIÁ (H2, H3, H5). Đủ để bắt đúng hai lỗi
    // đang hỏi: thẻ sống khi giá ngoài vùng, và hạng A với R thấp.
    openK: null, lastClosedK: null,
    rr, atr1h: null, low24h: null, high24h: null,
    low4hMaxVol: null, high4hMaxVol: null,
    cum1h: null, rejected1h: true,
    tp1OutsideVa: false, volRatio: null, opposingLegs: 0,
    tpBreaksUnbackedLevel: false, barsSinceIssued: 0,
  };
}

async function main() {
  const r = await fetch(`${URL_}/api/scan?symbols=${SYMS}`);
  const j = await r.json() as { ok?: boolean; symbols?: any[] };
  if (!j.symbols) { console.error('Không đọc được /api/scan:', JSON.stringify(j).slice(0, 300)); process.exit(1); }

  console.log(`Nguồn: ${URL_}/api/scan?symbols=${SYMS}`);
  // In lý do trước bảng: nếu bản kia đang thiếu dữ liệu thì bảng so bên dưới
  // không nói lên điều gì, và phải thấy ngay chứ không đọc nhầm thành "khớp".
  for (const d of (j as any).degraded ?? []) console.log(`  ! ${d}`);
  console.log('');
  let lech = 0;
  let coThe = 0;

  for (const s of j.symbols) {
    const last = num(s.price);
    console.log(`── ${s.symbol} · last ${last} ──`);
    console.log(`  ${pad('khung', 6)} ${pad('hướng', 6)} ${pad('entry', 19)} ${pad('SL', 10)} `
      + `${pad('R', 6)} ${pad('bản đang chạy', 26)} máy trạng thái`);

    for (const tf of TFS) {
      for (const [ten, t] of [['điện', s.direction?.[tf]], ['strict', s.tfs?.[tf]]] as [string, TheJson][]) {
        if (!t) continue;
        const i = tuJson(s.symbol, tf, t, last);
        const noiCu = t.lifecycle?.banner
          ?? (t.tradeable === true ? 'QUA CỬA (cờ cũ)' : t.tradeable === false ? 'chỉ theo dõi' : '—');
        if (!i) {
          console.log(`  ${pad(tf + '/' + ten, 12)} ${pad('WAIT / thiếu mức', 37)} ${pad(noiCu, 26)} không có thẻ`);
          continue;
        }
        coThe++;
        const v = evaluate(i);
        const cu = `${noiCu}${t.conviction ? ` · hạng ${t.conviction}` : ''}`;
        const moi = `${v.state} · ${v.banner}${v.failedGates.length ? ` [${v.failedGates.join(',')}]` : ''}`;
        const sai = (t.tradeable === true && v.state !== 'SONG')
          || (t.conviction === 'A' && v.grade !== 'A');
        if (sai) lech++;
        console.log(
          `  ${pad(tf + '/' + ten, 12)} ${pad(i.side, 6)} `
          + `${pad(`${i.entryLow}–${i.entryHigh}`, 19)} ${pad(i.sl, 10)} `
          + `${pad(i.rr?.toFixed(2) ?? 'N/A', 6)} ${pad(cu, 26)} ${moi}${sai ? '   ← LỆCH' : ''}`,
        );
      }
    }
    console.log('');
  }
  if (coThe === 0) {
    console.log('KHÔNG có thẻ nào để so — bản kia đang thiếu dữ liệu (xem dòng ! ở trên). '
      + 'Đây KHÔNG phải là "khớp".');
    process.exit(2);
  }
  console.log(lech === 0
    ? `Không thẻ nào lệch (đã so ${coThe} thẻ).`
    : `${lech}/${coThe} thẻ LỆCH: bản đang chạy cho vào tiền / cho hạng A trong khi máy trạng thái thì không.`);
  process.exit(lech === 0 ? 0 : 1);
}

void main();
