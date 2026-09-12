/**
 * PHÂN PHỐI LỢI SUẤT PHÍA TRƯỚC — có điều kiện theo trạng thái hiện tại.
 *
 *   npx tsx scripts/dubao.ts --symbols BTCUSDT,BNBUSDT
 *
 * Cách làm, và vì sao làm vậy:
 *
 * "Dự báo bằng xác suất" chỉ có nghĩa khi so được với MỐC VÔ ĐIỀU KIỆN. Nói
 * "65% khả năng tăng trong 7 ngày" là vô nghĩa nếu vô điều kiện cũng 63% — phần
 * thông tin thật chỉ là 2 điểm phần trăm, và trên n=80 thì 2 điểm đó nằm gọn
 * trong sai số.
 *
 * Nên script này luôn in ba thứ cạnh nhau: vô điều kiện, có điều kiện, và HIỆU
 * kèm sai số của hiệu. Chỉ khi hiệu vượt hẳn sai số thì trạng thái hiện tại mới
 * thật sự nói được điều gì.
 *
 * Không lookahead: mọi biến điều kiện tại thời điểm t chỉ dùng nến ĐÃ ĐÓNG tới
 * t; lợi suất phía trước lấy từ t về sau.
 */
import { nenDai, ngay, soNenChoNam } from './nendai';
import { fetchKlines } from '../lib/sources';
import type { Candle, TF } from '../lib/types';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const symbols = (arg('symbols', 'BTCUSDT,BNBUSDT') as string).split(',');
const nam = Number(arg('nam', '5'));

const pad = (x: unknown, n: number) => String(x).padEnd(n);
const pc = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;

function luongTu(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const tb = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function lechChuan(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = tb(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
/** Sai số chuẩn của tỷ lệ p trên n mẫu. */
const seTyLe = (p: number, n: number) => Math.sqrt((p * (1 - p)) / n);

interface TrangThai {
  /** Vị trí close trong biên độ 120 cây gần nhất, 0–1. */
  viTri: number;
  /** Biến động thực hiện: lệch chuẩn 120 lợi suất giờ gần nhất. */
  bienDong: number;
  /** close / SMA240 − 1. */
  soVoiTB: number;
}

/** Trạng thái tại cây `i`, CHỈ dùng nến tới `i`. */
function trangThai(c: Candle[], i: number): TrangThai | null {
  if (i < 240) return null;
  const w = c.slice(i - 119, i + 1);
  const hi = Math.max(...w.map((x) => x.h));
  const lo = Math.min(...w.map((x) => x.l));
  const r: number[] = [];
  for (let k = i - 119; k <= i; k++) r.push(Math.log(c[k].c / c[k - 1].c));
  const sma = tb(c.slice(i - 239, i + 1).map((x) => x.c));
  return {
    viTri: hi > lo ? (c[i].c - lo) / (hi - lo) : 0.5,
    bienDong: lechChuan(r),
    soVoiTB: c[i].c / sma - 1,
  };
}

/** Hai trạng thái có "giống nhau" không. Ngưỡng đặt trước, không dò theo kết quả. */
const giong = (a: TrangThai, b: TrangThai) =>
  Math.abs(a.viTri - b.viTri) <= 0.15
  && b.bienDong >= a.bienDong * 0.7 && b.bienDong <= a.bienDong * 1.43
  && Math.abs(a.soVoiTB - b.soVoiTB) <= 0.05;

interface Ket { n: number; pTang: number; tbLs: number; q10: number; q25: number; q50: number; q75: number; q90: number }

function tom(xs: number[]): Ket {
  return {
    n: xs.length,
    pTang: xs.filter((x) => x > 0).length / xs.length,
    tbLs: tb(xs),
    q10: luongTu(xs, 0.1), q25: luongTu(xs, 0.25), q50: luongTu(xs, 0.5),
    q75: luongTu(xs, 0.75), q90: luongTu(xs, 0.9),
  };
}

const HORIZON: [string, number][] = [['24 giờ', 24], ['3 ngày', 72], ['7 ngày', 168]];

/**
 * LẤY MẪU KHÔNG CHỒNG LẤN — chỗ dễ tự lừa mình nhất.
 *
 * Lấy hết các nến giờ có trạng thái giống hôm nay thì ra 4000+ "mẫu", nhưng
 * 4000 cửa sổ 7 ngày trùng nhau chỉ chứa vài chục đoạn thật sự độc lập. Sai số
 * tính theo n=4000 nhỏ đi khoảng mười lần so với sự thật, và mọi hiệu số đều
 * trông như "vượt sai số".
 *
 * Nên chỉ giữ những điểm cách nhau ÍT NHẤT một chân trời: cửa sổ phía trước của
 * chúng không đè lên nhau. n tụt xuống vài chục — đó mới là số mẫu thật.
 */
function thua(idx: number[], khoang: number): number[] {
  const out: number[] = [];
  for (const i of idx) if (!out.length || i - out[out.length - 1] >= khoang) out.push(i);
  return out;
}

async function main() {
  console.log(`Phân phối lợi suất phía trước · ${symbols.join(', ')} · nến 1H · ${nam} năm`);
  console.log('Vô điều kiện vs có điều kiện. Hiệu nhỏ hơn sai số = trạng thái hiện tại KHÔNG nói được gì.\n');

  for (const symbol of symbols) {
    const { nen, pv } = await nenDai(symbol, '1h' as TF, soNenChoNam('1h', nam));
    // Đệm đĩa có thể cũ vài ngày. Nạp nến MỚI rồi ghép theo mốc thời gian —
    // "trạng thái hiện tại" mà lấy từ nến hai hôm trước thì cả bài vô nghĩa.
    const moi = await fetchKlines(symbol, '1h' as TF, 500).catch(() => [] as Candle[]);
    const theoT = new Map(nen.map((x) => [x.t, x]));
    for (const x of moi) theoT.set(x.t, x);
    const c = [...theoT.values()].sort((a, b) => a.t - b.t).filter((x) => x.closed);
    if (c.length < 2000) { console.log(`${symbol}: thiếu dữ liệu (${c.length} nến)`); continue; }

    const iNay = c.length - 1;
    const nay = trangThai(c, iNay)!;
    console.log(`══ ${symbol} ══`);
    console.log(`  Mẫu: ${ngay(pv.tu)} → ${ngay(pv.den)} · ${c.length} nến 1H · nguồn ${pv.nguon}`);
    console.log(`  Giá đóng 1H gần nhất: ${c[iNay].c}`);
    console.log(`  Trạng thái hiện tại: vị trí trong biên 5 ngày ${(nay.viTri * 100).toFixed(0)}%`
      + ` · biến động giờ ${(nay.bienDong * 100).toFixed(2)}%`
      + ` · so với TB240 ${pc(nay.soVoiTB, 2)}`);

    // Tìm các thời điểm trong quá khứ có trạng thái GIỐNG hôm nay.
    const giongNhau: number[] = [];
    for (let i = 240; i < iNay; i++) {
      const t = trangThai(c, i);
      if (t && giong(nay, t)) giongNhau.push(i);
    }
    console.log(`  Số NẾN quá khứ ở trạng thái tương tự: ${giongNhau.length}`
      + ' (số ĐOẠN độc lập thấp hơn nhiều — xem cột n bên dưới)\n');

    console.log(`  ${pad('chân trời', 9)} ${pad('nhóm', 14)} ${pad('n', 7)} ${pad('P(tăng)', 10)}`
      + `${pad('TB', 9)} ${pad('q10', 9)} ${pad('q50', 9)} ${pad('q90', 9)}`);

    const tapGiong = new Set(giongNhau);
    for (const [ten, h] of HORIZON) {
      const hopLe = (i: number) => i + h < c.length;
      // Cả hai nhóm đều thưa cùng một cách, để so được với nhau.
      const iKhong = thua([...Array(c.length).keys()].filter((i) => i >= 240 && hopLe(i)), h);
      const iCo = thua(giongNhau.filter(hopLe), h);
      const ls = (i: number) => c[i + h].c / c[i].c - 1;
      const khongDk = iKhong.map(ls);
      const voiDk = iCo.map(ls);
      void tapGiong;
      if (!khongDk.length) continue;
      const a = tom(khongDk);
      const dong = (nhan: string, k: Ket) => console.log(
        `  ${pad(ten, 9)} ${pad(nhan, 14)} ${pad(k.n, 7)} ${pad((k.pTang * 100).toFixed(1) + '%', 10)}`
        + `${pad(pc(k.tbLs, 2), 9)} ${pad(pc(k.q10, 1), 9)} ${pad(pc(k.q50, 1), 9)} ${pad(pc(k.q90, 1), 9)}`);
      dong('vô điều kiện', a);
      if (voiDk.length >= 20) {
        const b = tom(voiDk);
        dong('giống hôm nay', b);
        // Hiệu và sai số của hiệu — đây mới là phần phải đọc.
        const dP = b.pTang - a.pTang;
        const seP = Math.sqrt(seTyLe(a.pTang, a.n) ** 2 + seTyLe(b.pTang, b.n) ** 2);
        const dTb = b.tbLs - a.tbLs;
        const seTb = Math.sqrt((lechChuan(khongDk) ** 2) / a.n + (lechChuan(voiDk) ** 2) / b.n);
        const dangKe = Math.abs(dP) > 2 * seP || Math.abs(dTb) > 2 * seTb;
        console.log(`  ${pad('', 9)} ${pad('→ hiệu', 14)} ${pad('', 7)}`
          + `${pad(`${dP >= 0 ? '+' : ''}${(dP * 100).toFixed(1)}pp ±${(seP * 100).toFixed(1)}`, 10)}`
          + `${pad(`${pc(dTb, 2)} ±${(seTb * 100).toFixed(2)}`, 9)}   `
          + (dangKe ? '← VƯỢT sai số' : 'nằm trong sai số → không nói được gì'));
      } else {
        console.log(`  ${pad(ten, 9)} ${pad('giống hôm nay', 14)} ${pad(voiDk.length, 7)} (dưới 20 đoạn độc lập — không tóm tắt)`);
      }
    }
    console.log('');
  }
}

void main();
