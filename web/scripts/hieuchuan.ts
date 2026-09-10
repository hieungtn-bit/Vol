/**
 * HIỆU CHUẨN LẠI NGƯỠNG CỬA — chọn trên nửa đầu, xác nhận trên nửa sau.
 *
 *   npx tsx scripts/hieuchuan.ts --tf 15m,1h,4h --bars 3000
 *
 * Bốn ngưỡng của cửa (nhất trí, |net| ≥ 15, Rkv ≤ 1.5, phí ≤ 10% của 1R) đều
 * được chọn từ những lần đo CÒN HAI LỖI MÔ PHỎNG. Bộ đo nay đã đúng, nhưng việc
 * chọn ngưỡng thì chưa độc lập với dữ liệu — đó là chỗ thiên lệch còn sót lại.
 *
 * `tradeable` chỉ là cờ ghi trên mỗi lệnh, `runBacktest` không lọc theo nó, nên
 * quét hậu kiểm ở đây là CHÍNH XÁC chứ không phải xấp xỉ.
 *
 * KỶ LUẬT: mọi con số dùng để CHỌN chỉ lấy từ nửa đầu. Nửa sau chỉ được nhìn một
 * lần, ở cuối, để xác nhận. Nhìn nửa sau rồi quay lại chỉnh là tự huỷ phép đo.
 */
import { FEES } from '../lib/direct';
import { DEFAULT_BT, runBacktest, stats, type Trade } from '../lib/backtest';
import { fetchKlinesHistory } from '../lib/sources';
import type { TF } from '../lib/types';

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,ENAUSDT,SOLUSDT,BNBUSDT,XRPUSDT') as string).split(',');
const tfs = (arg('tf', '15m,1h,4h') as string).split(',') as TF[];
const bars = Number(arg('bars', '3000'));

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const pad = (s: string | number, n: number) => String(s).padEnd(n);

/** Phí một vòng vào-ra, quy theo giá. Phải lấy từ FEES chứ không gõ lại số. */
const ROUND_TRIP = FEES.perSide * 2 + FEES.slip;

/**
 * Phí quy ra R từ độ rộng stop. Bằng đúng feeInR: slPct = risk/entry×100 nên
 * feeInR = ROUND_TRIP×entry/risk = ROUND_TRIP×100/slPct.
 *
 * Trả null khi không tính được, GIỐNG feeInR — và cửa thật cho `feeR == null`
 * đi qua (`feeR != null && feeR > max`). Trả Infinity ở đây là chặn nhầm.
 */
const feeShare = (t: Trade) => (t.slPct > 0 ? (ROUND_TRIP * 100) / t.slPct : null);

interface Gate { nhatTri: boolean; minNet: number; maxRkv: number; maxPhi: number }
const HIEN_TAI: Gate = { nhatTri: true, minNet: 15, maxRkv: 1.5, maxPhi: 0.10 };

/** Dựng lại đúng bốn điều kiện của cửa thật, kể cả cách xử null. */
const qua = (t: Trade, g: Gate) => {
  const phi = feeShare(t);
  return (!g.nhatTri || t.unanimous)
    && Math.abs(t.net) >= g.minNet
    && !(t.rrBlended != null && t.rrBlended > g.maxRkv)
    && !(phi != null && phi > g.maxPhi);
};

function se(t: Trade[]): number {
  if (t.length < 2) return NaN;
  const m = t.reduce((s, x) => s + x.r, 0) / t.length;
  const v = t.reduce((s, x) => s + (x.r - m) ** 2, 0) / (t.length - 1);
  return Math.sqrt(v / t.length);
}

const avg = (ts: Trade[]) => ts.reduce((s, x) => s + x.r, 0) / ts.length;

/**
 * So một ngưỡng với ngưỡng đang chạy thì KHÔNG được so hai trung bình gộp: hai
 * tập lồng nhau, phần chung kéo cả hai về gần nhau và giấu mất chuyện gì thật sự
 * xảy ra. Câu hỏi đúng là: những lệnh mà nới cửa NHẬN THÊM tự chúng lãi hay lỗ,
 * và những lệnh mà siết cửa BỎ ĐI tự chúng lãi hay lỗ.
 */
function dong(nhan: string, ts: Trade[], tong: number, goc?: Trade[]) {
  const s = stats(ts);
  if (!s.trades) { console.log(`  ${pad(nhan, 14)} (không lệnh nào)`); return; }
  let bien = '';
  if (goc) {
    const trongGoc = new Set(goc);
    const trongTs = new Set(ts);
    const them = ts.filter((t) => !trongGoc.has(t));
    const bo = goc.filter((t) => !trongTs.has(t));
    if (them.length) bien = `  nhận thêm ${them.length} lệnh → tự chúng avgR ${num(avg(them))} (±${num(se(them), 3)})`;
    else if (bo.length) bien = `  bỏ đi ${bo.length} lệnh → tự chúng avgR ${num(avg(bo))} (±${num(se(bo), 3)})`;
    else bien = '  (trùng cửa đang chạy)';
  }
  console.log(
    `  ${pad(nhan, 14)} n=${pad(s.trades, 5)} giữ ${pad(num((s.trades / tong) * 100, 0) + '%', 6)}` +
    ` avgR=${pad(num(s.avgR), 7)} PF=${pad(num(s.profitFactor), 6)} ±${pad(num(se(ts), 3), 6)}${bien}`,
  );
}

async function main() {
  console.log(`Hiệu chuẩn lại ngưỡng cửa · ${symbols.join(',')} · ${tfs.join(',')} · ${bars} nến\n`);

  const all: Trade[] = [];
  for (const tf of tfs) {
    for (const symbol of symbols) {
      const candles = await fetchKlinesHistory(symbol, tf, bars);
      if (candles.length < 200) continue;
      all.push(...runBacktest(symbol, tf, candles, DEFAULT_BT));
      process.stdout.write('.');
    }
  }
  console.log('');

  // ---- KIỂM CHỨNG BỘ ĐO TRƯỚC KHI TIN BẤT KỲ CON SỐ NÀO ----
  // Lần chạy đầu ra n=0 ở MỌI dòng, kể cả dòng ngưỡng bằng vô cực — vì hằng số
  // phí import sai tên nên vế phí thành NaN, mà NaN so sánh kiểu gì cũng false.
  // Nên trước khi quét, bắt buộc dựng lại cửa và đối chiếu với chính cờ
  // `tradeable` mà máy đã ghi. Lệch một lệnh cũng dừng, không báo cáo số rác.
  if (!(ROUND_TRIP > 0)) throw new Error(`ROUND_TRIP không hợp lệ: ${ROUND_TRIP}`);
  const lech = all.filter((t) => qua(t, HIEN_TAI) !== t.tradeable);
  if (lech.length) {
    console.error(
      `\nBỘ ĐO SAI: dựng lại cửa lệch ${lech.length}/${all.length} lệnh so với cờ tradeable.\n` +
      `Ví dụ: ${lech.slice(0, 3).map((t) => `${t.symbol} ${t.tf} net=${t.net} rkv=${t.rrBlended} slPct=${t.slPct.toFixed(2)} nhatTri=${t.unanimous} → dựng lại ${qua(t, HIEN_TAI)} nhưng máy ghi ${t.tradeable}`).join(' | ')}`,
    );
    process.exit(1);
  }
  console.log(`Bộ đo khớp: dựng lại cửa trùng cờ tradeable trên cả ${all.length} lệnh.`);

  const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
  const cut = Math.floor(sorted.length / 2);
  const dau = sorted.slice(0, cut);
  const sau = sorted.slice(cut);
  console.log(`\n${sorted.length} lệnh · nửa đầu ${dau.length} · nửa sau ${sau.length}`);
  console.log('CHỌN chỉ nhìn nửa đầu. Nửa sau chỉ nhìn một lần ở cuối.\n');

  // Mốc so sánh: KHÔNG cửa nào. Chú thích trong direct.ts trích một cặp số
  // "trước cửa → sau cửa" đo bằng bộ mô phỏng còn lỗi; in lại đây để sửa cho đúng.
  for (const [ten, tap] of [['nửa đầu', dau], ['nửa sau', sau]] as [string, Trade[]][]) {
    const k = stats(tap);
    const c = stats(tap.filter((t) => qua(t, HIEN_TAI)));
    console.log(
      `  ${pad(ten, 8)} không cửa: n=${pad(k.trades, 5)} avgR ${pad(num(k.avgR), 7)} PF ${pad(num(k.profitFactor), 6)}` +
      ` │ qua cửa: n=${pad(c.trades, 5)} avgR ${pad(num(c.avgR), 7)} PF ${num(c.profitFactor)}`,
    );
  }
  console.log('');

  // ---- BẢNG ĐỘ RỘNG STOP ----
  // direct.ts gọi vế phí là "điều kiện quan trọng nhất", và dẫn một bảng tách
  // gộp/phí/ròng theo độ rộng stop. Bảng đó đo bằng BỘ MÔ PHỎNG CÒN LỖI. Dựng
  // lại đây trên bộ đã sửa để biết lời chú thích trong mã còn đúng hay không.
  console.log('══ NỬA ĐẦU · tách theo độ rộng stop (không qua cửa nào) ══');
  const moc = [0, 0.5, 1, 1.5, 2, 3, Infinity];
  for (let i = 0; i < moc.length - 1; i++) {
    const lo = moc[i], hi = moc[i + 1];
    const g = dau.filter((t) => t.slPct >= lo && t.slPct < hi);
    if (!g.length) continue;
    const gop = g.reduce((a, t) => a + t.rGross, 0) / g.length;
    const phi = g.reduce((a, t) => a + t.costR, 0) / g.length;
    const rong = g.reduce((a, t) => a + t.r, 0) / g.length;
    const nhan = hi === Infinity ? `> ${lo}%` : `${lo}–${hi}%`;
    console.log(
      `  stop ${pad(nhan, 9)} n=${pad(g.length, 5)} R gộp ${pad(num(gop), 7)}` +
      ` phí ${pad(num(phi), 7)} → ròng ${pad(num(rong), 7)} ±${num(se(g), 3)}`,
    );
  }
  console.log('');

  const gocDau = dau.filter((t) => qua(t, HIEN_TAI));

  // ---- Quét từng ngưỡng, giữ ba ngưỡng kia ở giá trị đang chạy ----
  console.log('══ NỬA ĐẦU · quét từng ngưỡng một ══');

  console.log('\n── điều kiện nhất trí ──');
  for (const nhatTri of [false, true]) {
    dong(nhatTri ? 'bắt buộc' : 'bỏ qua', dau.filter((t) => qua(t, { ...HIEN_TAI, nhatTri })), dau.length, gocDau);
  }

  console.log('\n── |net| tối thiểu (đang chạy: 15) ──');
  for (const minNet of [0, 10, 15, 20, 25, 30]) {
    dong(`≥ ${minNet}`, dau.filter((t) => qua(t, { ...HIEN_TAI, minNet })), dau.length, gocDau);
  }

  console.log('\n── Rkv tối đa (đang chạy: 1.5) ──');
  for (const maxRkv of [1.0, 1.2, 1.5, 2.0, 3.0, Infinity]) {
    dong(`≤ ${maxRkv === Infinity ? '∞' : maxRkv}`, dau.filter((t) => qua(t, { ...HIEN_TAI, maxRkv })), dau.length, gocDau);
  }

  console.log('\n── phí tối đa theo 1R (đang chạy: 0.10, ứng với stop ≥ 1.2% giá) ──');
  for (const maxPhi of [0.06, 0.08, 0.10, 0.12, 0.15, Infinity]) {
    const stop = maxPhi === Infinity ? '—' : num((ROUND_TRIP * 100) / maxPhi, 2) + '%';
    dong(`≤ ${maxPhi === Infinity ? '∞' : maxPhi} (${stop})`, dau.filter((t) => qua(t, { ...HIEN_TAI, maxPhi })), dau.length, gocDau);
  }

  // ---- Xác nhận trên nửa sau: chỉ so cửa ĐANG CHẠY với vài ứng viên ----
  console.log('\n══ NỬA SAU · xác nhận (nhìn một lần) ══');
  const ungVien: { ten: string; g: Gate }[] = [
    { ten: 'đang chạy', g: HIEN_TAI },
    { ten: 'bỏ nhất trí', g: { ...HIEN_TAI, nhatTri: false } },
    { ten: 'net ≥ 20', g: { ...HIEN_TAI, minNet: 20 } },
    { ten: 'net ≥ 25', g: { ...HIEN_TAI, minNet: 25 } },
    { ten: 'Rkv ≤ 1.2', g: { ...HIEN_TAI, maxRkv: 1.2 } },
    { ten: 'Rkv ≤ ∞', g: { ...HIEN_TAI, maxRkv: Infinity } },
    { ten: 'phí ≤ 0.08', g: { ...HIEN_TAI, maxPhi: 0.08 } },
    { ten: 'phí ≤ 0.15', g: { ...HIEN_TAI, maxPhi: 0.15 } },
  ];
  // Cột cuối là thứ quyết định: những lệnh mà đổi ngưỡng sẽ NHẬN THÊM (hoặc BỎ
  // ĐI) ở nửa sau, đo riêng chúng. Trung bình gộp của hai tập lồng nhau không
  // trả lời được câu "đổi ngưỡng thì lời hay lỗ".
  const gocSau = sau.filter((t) => qua(t, HIEN_TAI));
  const trongGocSau = new Set(gocSau);
  console.log(`  ${pad('cửa', 14)} ${pad('nửa đầu', 30)} ${pad('nửa sau', 34)} phần chênh ở nửa sau`);
  for (const { ten, g } of ungVien) {
    const a = stats(dau.filter((t) => qua(t, g)));
    const b = sau.filter((t) => qua(t, g));
    const s = stats(b);
    const trongB = new Set(b);
    const them = b.filter((t) => !trongGocSau.has(t));
    const bo = gocSau.filter((t) => !trongB.has(t));
    const bien = them.length
      ? `nhận thêm ${them.length} → avgR ${num(avg(them))} (±${num(se(them), 3)})`
      : bo.length
        ? `bỏ đi ${bo.length} → avgR ${num(avg(bo))} (±${num(se(bo), 3)})`
        : '—';
    console.log(
      `  ${pad(ten, 14)} ${pad(`n=${a.trades} avgR ${num(a.avgR)} PF ${num(a.profitFactor)}`, 30)}` +
      ` ${pad(`n=${s.trades} avgR ${num(s.avgR)} PF ${num(s.profitFactor)} ±${num(se(b), 3)}`, 34)} ${bien}`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
