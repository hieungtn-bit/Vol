/**
 * ĐO CẢNH BÁO SỚM — trước khi cho bất cứ cảnh báo nào vào hệ.
 *
 *   npx tsx scripts/doCanhBao.ts --nam 5
 *
 * Câu hỏi: một trạng thái NÉN có báo trước được cú biến động lớn không, và báo
 * trước bao nhiêu so với việc đoán bừa?
 *
 * Sự kiện: trong `gio` giờ tới, độ dịch chuyển lớn nhất (cả hai phía) vượt
 * ngưỡng. Ngưỡng = phân vị 90 của chính đại lượng đó, LẤY TỪ NỬA ĐẦU, rồi áp
 * cho cả hai nửa — nên tỷ lệ nền ở nửa đầu đúng bằng 10% theo thiết kế, và mọi
 * con số "bắt được bao nhiêu" đọc thẳng ra được là hơn đoán bừa mấy lần.
 *
 * KỶ LUẬT: chọn ngưỡng đặc trưng CHỈ trên nửa đầu. Nửa sau nhìn một lần ở cuối.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dacTrungTai, bienDongToi, NEN_TANG, type BangCanhBao, type DacTrung } from '../lib/canhBao';
import { nenDai, ngay, soNenChoNam } from './nendai';
import type { TF } from '../lib/types';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const symbols = (arg('symbols', 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ENAUSDT') as string).split(',');
const nam = Number(arg('nam', '5'));
const GIO = Number(arg('gio', '24'));

const pad = (x: unknown, n: number) => String(x).padEnd(n);
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

function luongTu(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const seTyLe = (p: number, n: number) => Math.sqrt((p * (1 - p)) / n);

interface Diem { dt: DacTrung; sk: number; nua: 0 | 1; i: number; ma: string }

/**
 * Mẫu thưa: các điểm cách nhau ít nhất một chân trời, để cửa sổ phía trước
 * không đè lên nhau.
 *
 * PHẢI thưa TRONG TỪNG MÃ. Bản đầu tôi thưa trên mảng đã gộp sáu mã, mà chỉ số
 * nến reset ở mỗi mã — nên sau khi đi hết mã thứ nhất, mọi điểm của năm mã sau
 * đều có `i` nhỏ hơn điểm cuối và bị loại sạch. Mẫu tưởng là sáu mã, thật ra
 * chỉ có BTC (907 điểm ≈ 21.800/24).
 */
function thuaTheoMa(ds: Diem[], khoang: number): Diem[] {
  const out: Diem[] = [];
  const cuoi = new Map<string, number>();
  for (const d of ds) {
    const t = cuoi.get(d.ma);
    if (t == null || d.i - t >= khoang) { out.push(d); cuoi.set(d.ma, d.i); }
  }
  return out;
}

const TEN: Record<keyof DacTrung, string> = {
  nenVol: 'nén biến động (sd24/sd168)',
  nenBienDo: 'nén biên độ (bđ24/bđ tuần)',
  nenVol24: 'cạn khối lượng (vol24/tuần)',
  xaTrungBinh: 'xa trung bình |c/SMA168−1|',
  xaChuanHoa: 'xa trung bình / sd168 (chuẩn hoá)',
};

async function main() {
  console.log(`Đo cảnh báo sớm · ${symbols.join(',')} · nến 1H · ${nam} năm · chân trời ${GIO}h\n`);
  console.log('Sự kiện = độ dịch chuyển lớn nhất (cả hai phía) trong 24h tới vượt phân vị 90 của NỬA ĐẦU.');
  console.log('Tỷ lệ nền ở nửa đầu vì thế đúng bằng 10% theo thiết kế.\n');

  // ---- Gom điểm từ mọi mã. Mỗi mã chia đôi theo thời gian của chính nó. ----
  const tatCa: Diem[] = [];
  for (const symbol of symbols) {
    const { nen, pv } = await nenDai(symbol, '1h' as TF, soNenChoNam('1h', nam));
    const c = nen.filter((x) => x.closed);
    if (c.length < 2000) { console.log(`  ${symbol}: thiếu dữ liệu`); continue; }
    const cat = Math.floor(c.length / 2);
    let n = 0;
    for (let i = NEN_TANG; i + GIO < c.length; i++) {
      const dt = dacTrungTai(c, i);
      const sk = bienDongToi(c, i, GIO);
      if (!dt || sk == null || !Number.isFinite(dt.nenVol)) continue;
      // `i` là chỉ số TRONG CHUỖI của chính mã này — thưa mẫu dựa vào nó.
      tatCa.push({ dt, sk, nua: i < cat ? 0 : 1, i, ma: symbol });
      n++;
    }
    console.log(`  ${pad(symbol, 9)} ${n} điểm · ${ngay(pv.tu)} → ${ngay(pv.den)}`);
  }
  console.log('');

  const dau = thuaTheoMa(tatCa.filter((d) => d.nua === 0), GIO);
  const sau = thuaTheoMa(tatCa.filter((d) => d.nua === 1), GIO);
  const soMa = new Set(dau.map((d) => d.ma)).size;
  const NGUONG_SK = luongTu(dau.map((d) => d.sk), 0.9);
  const co = (d: Diem) => d.sk > NGUONG_SK;
  const nenDau = dau.filter(co).length / dau.length;
  const nenSau = sau.filter(co).length / sau.length;

  console.log(`Ngưỡng sự kiện (phân vị 90 nửa đầu): dịch chuyển > ${pct(NGUONG_SK, 2)} trong ${GIO}h`);
  console.log(`Tỷ lệ nền — nửa đầu ${pct(nenDau)} (n=${dau.length}) · nửa sau ${pct(nenSau)} (n=${sau.length})`);
  console.log(`Số mã thật sự lọt vào mẫu: ${soMa}/${symbols.length}\n`);

  // ---- Quét từng đặc trưng trên NỬA ĐẦU ----
  console.log('══ NỬA ĐẦU · mỗi đặc trưng, chia mười nhóm ══');
  const ungVien: { ten: string; loc: (d: Diem) => boolean; nhan: string }[] = [];

  for (const k of Object.keys(TEN) as (keyof DacTrung)[]) {
    const gt = dau.map((d) => d.dt[k]).filter(Number.isFinite);
    if (gt.length < 100) continue;
    console.log(`\n── ${TEN[k]} ──`);
    for (const [nhan, lo, hi] of [
      ['10% thấp nhất', 0, 0.1], ['10–30%', 0.1, 0.3], ['giữa 30–70%', 0.3, 0.7],
      ['70–90%', 0.7, 0.9], ['10% cao nhất', 0.9, 1],
    ] as [string, number, number][]) {
      const a = lo === 0 ? -Infinity : luongTu(gt, lo);
      const b = hi === 1 ? Infinity : luongTu(gt, hi);
      const loc = (d: Diem) => Number.isFinite(d.dt[k]) && d.dt[k] > a && d.dt[k] <= b;
      const nhom = dau.filter(loc);
      if (nhom.length < 30) { console.log(`  ${pad(nhan, 15)} (dưới 30 điểm)`); continue; }
      const p = nhom.filter(co).length / nhom.length;
      const se = seTyLe(p, nhom.length);
      const lift = p / nenDau;
      const dangKe = Math.abs(p - nenDau) > 2 * Math.sqrt(se ** 2 + seTyLe(nenDau, dau.length) ** 2);
      console.log(`  ${pad(nhan, 15)} n=${pad(nhom.length, 6)} P(sự kiện)=${pad(pct(p), 7)}`
        + `±${pad(pct(se), 6)} gấp ${pad(lift.toFixed(2), 6)} lần nền   ${dangKe ? '← vượt sai số' : ''}`);
      if (dangKe && lift > 1.3) ungVien.push({ ten: `${TEN[k]} · ${nhan}`, loc, nhan });
    }
  }

  // ---- LUẬT THẮNG CÓ ĐÚNG TRÊN TỪNG MÃ KHÔNG? ----
  // Gộp sáu mã rồi thấy 4.5 lần nền có thể chỉ là hai mã kéo cả rổ. Nếu luật
  // chỉ sống ở vài mã thì nó là đặc tính của mã đó, không phải của thị trường —
  // và ngưỡng dùng chung sẽ sai ở phần còn lại.
  console.log('══ TỪNG MÃ · xa trung bình, nhóm 10% cao nhất ══');
  console.log(`  ${pad('mã', 10)} ${pad('ngưỡng', 9)} ${pad('nửa đầu', 26)} nửa sau`);
  const nguongMa: Record<string, number> = {};
  for (const ma of symbols) {
    const dA = dau.filter((d) => d.ma === ma);
    const dB = sau.filter((d) => d.ma === ma);
    if (dA.length < 100 || dB.length < 100) { console.log(`  ${pad(ma, 10)} (thiếu điểm)`); continue; }
    // Ngưỡng lấy từ NỬA ĐẦU của chính mã đó, rồi áp cho nửa sau.
    const ng = luongTu(dA.map((d) => d.dt.xaTrungBinh).filter(Number.isFinite), 0.9);
    nguongMa[ma] = ng;
    const cham = (ds: Diem[]) => ds.filter((d) => d.dt.xaTrungBinh > ng);
    const nenA = dA.filter(co).length / dA.length;
    const nenB = dB.filter(co).length / dB.length;
    const a = cham(dA), b = cham(dB);
    const pA = a.filter(co).length / a.length;
    const pB = b.length ? b.filter(co).length / b.length : NaN;
    console.log(`  ${pad(ma, 10)} ${pad(pct(ng, 2), 9)} `
      + `${pad(`n=${a.length} P=${pct(pA)} gấp ${(pA / nenA).toFixed(2)}`, 26)}`
      + `n=${b.length} P=${pct(pB)} gấp ${(pB / nenB).toFixed(2)}`);
  }
  console.log(`\n  Ngưỡng mỗi mã (phân vị 90 nửa đầu): `
    + Object.entries(nguongMa).map(([m, v]) => `${m.replace('USDT', '')} ${pct(v, 2)}`).join(' · '));

  // ---- Ghi bảng hiệu chuẩn để hệ dùng lúc chạy ----
  if (process.argv.includes('--ghi')) {
    const ma: BangCanhBao['ma'] = {};
    for (const m of Object.keys(nguongMa)) {
      const dB = sau.filter((d) => d.ma === m);
      const b = dB.filter((d) => d.dt.xaTrungBinh > nguongMa[m]);
      const nenB = dB.filter(co).length / dB.length;
      const pB = b.length ? b.filter(co).length / b.length : NaN;
      ma[m] = {
        nguong: nguongMa[m],
        nenNgoaiMau: nenB,
        pNgoaiMau: pB,
        gapNen: pB / nenB,
        nNgoaiMau: b.length,
      };
    }
    const bang: BangCanhBao = {
      taoLuc: Date.now(),
      gio: GIO,
      nguongSuKien: NGUONG_SK,
      moTaSuKien: `dịch chuyển lớn nhất (cả hai phía) trong ${GIO}h vượt ${pct(NGUONG_SK, 2)}`,
      ma,
    };
    const ra = join(process.cwd(), 'data', 'canh-bao.json');
    mkdirSync(dirname(ra), { recursive: true });
    writeFileSync(ra, JSON.stringify(bang, null, 1));
    console.log(`\n  Đã ghi ${ra}`);
  }
  console.log('');

  // ---- Bốn đặc trưng có phải bốn cách đo CÙNG MỘT THỨ không? ----
  // Nếu chúng trùng nhau thì gộp lại không thêm được gì, và "bốn tín hiệu cùng
  // báo" chỉ là một tín hiệu đếm bốn lần.
  console.log('\n══ NỬA ĐẦU · bốn đặc trưng có trùng nhau không ══');
  const dinh = (k: keyof DacTrung, ds: Diem[]) => {
    const gt = ds.map((d) => d.dt[k]).filter(Number.isFinite);
    const nguong = luongTu(gt, 0.9);
    return (d: Diem) => Number.isFinite(d.dt[k]) && d.dt[k] > nguong;
  };
  const keys = Object.keys(TEN) as (keyof DacTrung)[];
  const locDau = keys.map((k) => dinh(k, dau));
  console.log(`  ${pad('', 30)} ${keys.map((k) => pad(k.slice(0, 9), 11)).join('')}`);
  for (let a = 0; a < keys.length; a++) {
    const hang = keys.map((_, b) => {
      const A = dau.filter(locDau[a]);
      const chung = A.filter(locDau[b]).length;
      return pad(`${((chung / A.length) * 100).toFixed(0)}%`, 11);
    }).join('');
    console.log(`  ${pad(TEN[keys[a]].slice(0, 29), 30)} ${hang}`);
  }
  console.log('  (đọc theo hàng: trong nhóm đỉnh của hàng này, bao nhiêu % cũng nằm ở đỉnh của cột kia)');

  // Gộp: cần ÍT NHẤT hai đặc trưng cùng ở nhóm đỉnh.
  const demDau = (d: Diem) => locDau.filter((f) => f(d)).length;
  for (const toiThieu of [2, 3]) {
    const nhom = dau.filter((d) => demDau(d) >= toiThieu);
    if (nhom.length < 30) continue;
    const p = nhom.filter(co).length / nhom.length;
    console.log(`  gộp ≥${toiThieu} đặc trưng ở đỉnh: n=${nhom.length} P=${pct(p)} ±${pct(seTyLe(p, nhom.length))}`
      + ` gấp ${(p / nenDau).toFixed(2)} lần nền`);
    ungVien.push({ ten: `gộp ≥${toiThieu} đặc trưng ở đỉnh`, loc: (d) => demDau(d) >= toiThieu, nhan: '' });
  }

  // ---- Xác nhận trên NỬA SAU, nhìn một lần ----
  console.log('\n══ NỬA SAU · xác nhận (nhìn một lần) ══');
  if (!ungVien.length) {
    console.log('  Không đặc trưng nào ở nửa đầu vừa vượt sai số vừa gấp nền ≥ 1.3 lần.');
    console.log('  → Không có gì để mang sang. Đây là kết quả, không phải thiếu sót.');
    return;
  }
  console.log(`  ${pad('luật', 46)} ${pad('n', 7)} ${pad('P(sự kiện)', 12)} gấp nền`);
  for (const u of ungVien) {
    const nhom = sau.filter(u.loc);
    if (nhom.length < 30) { console.log(`  ${pad(u.ten, 46)} (dưới 30 điểm ở nửa sau)`); continue; }
    const p = nhom.filter(co).length / nhom.length;
    const se = seTyLe(p, nhom.length);
    console.log(`  ${pad(u.ten, 46)} ${pad(nhom.length, 7)} ${pad(`${pct(p)} ±${pct(se)}`, 12)}`
      + `${(p / nenSau).toFixed(2)}`);
  }
}

void main();
