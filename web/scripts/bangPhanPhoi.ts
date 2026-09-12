/**
 * DỰNG BẢNG PHÂN PHỐI — chạy OFFLINE, kết quả commit vào repo.
 *
 *   npx tsx scripts/bangPhanPhoi.ts --symbols BTCUSDT,BNBUSDT --nam 5
 *
 * Vì sao offline: quét 43k nến với cửa sổ 240 là việc của một lần, không phải
 * của mỗi lần có người mở trang. Phân phối lịch sử đổi rất chậm — chạy lại hàng
 * tháng là đủ, và ngày tạo được ghi thẳng vào bảng để trang nói ra tuổi của nó.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nenDai, ngay, soNenChoNam } from './nendai';
import {
  CUA_SO_TB, luongTu, oCua, tomTat, trangThaiTai,
  type BangMot, type BangPhanPhoi, type ChanTroi, type TomTat,
} from '../lib/phanPhoi';
import type { TF } from '../lib/types';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const symbols = (arg('symbols', 'BTCUSDT,BNBUSDT') as string).split(',');
const nam = Number(arg('nam', '5'));
const RA = arg('out', join(process.cwd(), 'data', 'phan-phoi.json')) as string;

const CHAN_TROI: ChanTroi[] = [
  { gio: 24, ten: '24 giờ' },
  { gio: 72, ten: '3 ngày' },
  { gio: 168, ten: '7 ngày' },
];

/**
 * LẤY MẪU KHÔNG CHỒNG LẤN — chỗ dễ tự lừa mình nhất trong cả bài.
 *
 * Lấy hết các nến giờ ở cùng một ô thì ra vài nghìn "mẫu", nhưng vài nghìn cửa
 * sổ 7 ngày trùng nhau chỉ chứa vài chục đoạn thật sự độc lập. Sai số tính theo
 * n đó nhỏ đi khoảng mười lần so với sự thật, và MỌI hiệu số đều trông như
 * "vượt sai số". Giữ các điểm cách nhau ít nhất một chân trời thì cửa sổ phía
 * trước của chúng không đè lên nhau.
 */
function thua(idx: number[], khoang: number): number[] {
  const out: number[] = [];
  for (const i of idx) if (!out.length || i - out[out.length - 1] >= khoang) out.push(i);
  return out;
}

async function motMa(symbol: string): Promise<BangMot | null> {
  const { nen, pv } = await nenDai(symbol, '1h' as TF, soNenChoNam('1h', nam));
  const c = nen.filter((x) => x.closed);
  if (c.length < 2000) { console.log(`  ${symbol}: thiếu dữ liệu (${c.length} nến)`); return null; }

  // Ngưỡng chia ba nhóm biến động = tam phân vị của chính mẫu này.
  const bd: number[] = [];
  const tt: (ReturnType<typeof trangThaiTai>)[] = new Array(c.length).fill(null);
  for (let i = CUA_SO_TB; i < c.length; i++) {
    const t = trangThaiTai(c, i);
    tt[i] = t;
    if (t) bd.push(t.bienDong);
  }
  const nguongBienDong: [number, number] = [luongTu(bd, 1 / 3), luongTu(bd, 2 / 3)];

  const voDieuKien: TomTat[] = [];
  const oNhom: Record<string, TomTat[]> = {};

  for (let hi = 0; hi < CHAN_TROI.length; hi++) {
    const h = CHAN_TROI[hi].gio;
    const hopLe = (i: number) => i >= CUA_SO_TB && i + h < c.length && tt[i] != null;
    const ls = (i: number) => c[i + h].c / c[i].c - 1;

    const tatCa = [...Array(c.length).keys()].filter(hopLe);
    voDieuKien.push(tomTat(thua(tatCa, h).map(ls)));

    // Gom theo ô, rồi THƯA TRONG TỪNG Ô — thưa trước khi gom sẽ làm ô nào cũng
    // mất phần lớn điểm của mình.
    const theoO = new Map<string, number[]>();
    for (const i of tatCa) {
      const k = oCua(tt[i]!, nguongBienDong);
      (theoO.get(k) ?? theoO.set(k, []).get(k)!).push(i);
    }
    for (const [k, idx] of theoO) {
      (oNhom[k] ??= [])[hi] = tomTat(thua(idx, h).map(ls));
    }
  }

  console.log(`  ${symbol}: ${c.length} nến · ${ngay(pv.tu)} → ${ngay(pv.den)} · ${Object.keys(oNhom).length} ô`);
  for (let i = 0; i < CHAN_TROI.length; i++) {
    const v = voDieuKien[i];
    const nO = Object.values(oNhom).map((x) => x[i]?.n ?? 0);
    console.log(`     ${CHAN_TROI[i].ten.padEnd(7)} vô điều kiện n=${String(v.n).padStart(5)}`
      + ` · n mỗi ô ${Math.min(...nO)}–${Math.max(...nO)}`);
  }

  return {
    symbol,
    tuNgay: ngay(pv.tu), denNgay: ngay(pv.den), soNen: c.length,
    nguongBienDong, voDieuKien, oNhom,
  };
}

async function main() {
  console.log(`Dựng bảng phân phối · ${symbols.join(', ')} · nến 1H · ${nam} năm\n`);
  const bang: Record<string, BangMot> = {};
  for (const s of symbols) {
    const b = await motMa(s);
    if (b) bang[s] = b;
  }
  const ra: BangPhanPhoi = {
    taoLuc: Date.now(),
    nguon: 'Binance spot klines 1H (data-api.binance.vision)',
    chanTroi: CHAN_TROI,
    bang,
  };
  mkdirSync(dirname(RA), { recursive: true });
  writeFileSync(RA, JSON.stringify(ra));
  const kb = (JSON.stringify(ra).length / 1024).toFixed(0);
  console.log(`\nĐã ghi ${RA} (${kb} KB)`);
}

void main();
