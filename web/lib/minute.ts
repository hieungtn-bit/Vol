import { inflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Candle } from './types';

// ============================================================
// NẾN 1 PHÚT TỪ KHO LƯU TRỮ CÔNG KHAI CỦA BINANCE.
//
// Dùng để THAY MỘT GIẢ ĐỊNH BẰNG MỘT SỐ ĐO. Trong một nến 1h, khi giá chạm cả
// stop lẫn mục tiêu, dữ liệu nến không nói được cái nào trước, nên mô phỏng phải
// đoán — và đoán thận trọng thì lệch về phía bi quan: một cú nhúng vào entry rồi
// bật lên TP1 trong cùng một nến là mẫu thắng có thật, mà giả định thận trọng lại
// bỏ nó. Nến 1 phút thu cửa sổ mù từ 60 phút xuống 1 phút.
//
// Trong chính phút đó vẫn còn mù, nên quy tắc "nghi ngờ thì chọn phía xấu" vẫn
// giữ nguyên — chỉ là áp ở mức 1 phút thay vì 1 giờ.
//
// Nguồn: https://data.binance.vision/data/spot/monthly/klines/<SYMBOL>/1m/
// Đây là file tĩnh, không phải API, nên không bị chặn IP như fapi.
//
// BẪY ĐÃ VẤP: mốc thời gian trong file spot là MICRO giây (1782864000000000),
// không phải mili giây. Không chuẩn hoá thì mọi nến rơi ra ngoài cửa sổ và hàm
// lặng lẽ trả rỗng — tức là lặng lẽ quay về đúng giả định mà nó đang định thay.
// ============================================================

const ARCHIVE = process.env.BINANCE_ARCHIVE_BASE ?? 'https://data.binance.vision';
const CACHE_DIR = process.env.MINUTE_CACHE_DIR ?? '.cache/minute';

/** Mốc thời gian có thể là ms, µs hoặc ns tuỳ file. Đưa hết về ms. */
export function toMs(x: number): number {
  if (x > 1e17) return Math.floor(x / 1e6);   // nano
  if (x > 1e14) return Math.floor(x / 1e3);   // micro
  return x;
}

/**
 * Đọc file ZIP tối giản: chỉ cần lấy entry đầu tiên. Binance đóng gói đúng một
 * file CSV mỗi zip, nén DEFLATE hoặc để nguyên.
 *
 * Tự đọc thay vì thêm một thư viện: phần cần dùng chỉ có bấy nhiêu, và một
 * dependency mới trong đường chạy backtest là một thứ nữa phải tin.
 */
export function unzipFirst(buf: Buffer): string {
  // Local file header: 0x04034b50
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('không phải file ZIP');
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;

  // Kích thước có thể nằm ở data descriptor (cỡ = 0 trong header) — khi đó phải
  // tìm ngược từ central directory.
  let size = buf.readUInt32LE(18);
  if (size === 0) {
    const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (cd < 0) throw new Error('ZIP thiếu central directory');
    size = buf.readUInt32LE(cd + 20);
  }
  const body = buf.subarray(start, start + size);
  if (method === 0) return body.toString('utf8');
  if (method === 8) return inflateRawSync(body).toString('utf8');
  throw new Error(`ZIP dùng phương pháp nén ${method} chưa hỗ trợ`);
}

/** Một dòng CSV kline của Binance → Candle. */
function parseRow(line: string): Candle | null {
  const f = line.split(',');
  if (f.length < 11) return null;
  const t = toMs(Number(f[0]));
  if (!Number.isFinite(t)) return null;
  return {
    t, o: +f[1], h: +f[2], l: +f[3], c: +f[4], v: +f[5], q: +f[7],
    takerBuyBase: f[9] !== undefined ? +f[9] : null,
    closed: true,
  };
}

function monthsBetween(fromMs: number, toMsEnd: number): string[] {
  const out: string[] = [];
  const d = new Date(fromMs);
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= toMsEnd) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

async function download(url: string, cachePath: string): Promise<Buffer | null> {
  if (existsSync(cachePath)) {
    const b = readFileSync(cachePath);
    return b.length === 0 ? null : b;   // file rỗng = đã biết là 404, đừng hỏi lại
  }
  const r = await fetch(url);
  mkdirSync(dirname(cachePath), { recursive: true });
  if (!r.ok) { writeFileSync(cachePath, Buffer.alloc(0)); return null; }
  const b = Buffer.from(await r.arrayBuffer());
  writeFileSync(cachePath, b);
  return b;
}

function daysIn(month: string, fromMs: number, toMsEnd: number): string[] {
  const [y, mo] = month.split('-').map(Number);
  const out: string[] = [];
  const d = new Date(Date.UTC(y, mo - 1, 1));
  while (d.getUTCMonth() === mo - 1) {
    const t = d.getTime();
    if (t + 86_400_000 > fromMs && t <= toMsEnd) {
      out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Tải nến 1m spot cho một mã, phủ khoảng [fromMs, toMs].
 *
 * Ưu tiên file THÁNG: một backtest 3000 nến 1h phủ ~125 ngày, tức 5 file tháng
 * thay vì 125 file ngày hay 180 lần gọi API.
 *
 * THÁNG HIỆN TẠI CHƯA CÓ FILE THÁNG — Binance chỉ đóng gói khi tháng đã xong. Bỏ
 * qua nó thì đoạn gần đây nhất, tức đoạn đáng tin nhất, lại là đoạn duy nhất
 * không gỡ được thứ tự; lần đo đầu chỉ phủ 68% số lệnh đúng vì lý do này. Thiếu
 * file tháng thì rơi xuống file NGÀY.
 */
export async function loadMinutes(symbol: string, fromMs: number, toMsEnd: number): Promise<Candle[]> {
  const out: Candle[] = [];
  const take = (csv: string) => {
    for (const line of csv.split('\n')) {
      const c = parseRow(line.trim());
      if (c && c.t >= fromMs && c.t <= toMsEnd) out.push(c);
    }
  };

  for (const m of monthsBetween(fromMs, toMsEnd)) {
    const name = `${symbol}-1m-${m}.zip`;
    const buf = await download(`${ARCHIVE}/data/spot/monthly/klines/${symbol}/1m/${name}`, join(CACHE_DIR, symbol, name));
    if (buf) { take(unzipFirst(buf)); continue; }

    for (const day of daysIn(m, fromMs, toMsEnd)) {
      const dn = `${symbol}-1m-${day}.zip`;
      const db = await download(`${ARCHIVE}/data/spot/daily/klines/${symbol}/1m/${dn}`, join(CACHE_DIR, symbol, dn));
      if (db) take(unzipFirst(db));
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Tra nến 1m nằm trong một nến lớn. Trả null khi không có dữ liệu — và người gọi
 * PHẢI quay về giả định thận trọng chứ không được coi như "không có gì xảy ra".
 */
export type MinuteFeed = (fromMs: number, toMsEnd: number) => Candle[] | null;

/** Dựng feed tra cứu nhanh từ một mảng nến 1m đã tải. */
export function minuteFeed(minutes: Candle[]): MinuteFeed {
  if (minutes.length === 0) return () => null;
  const first = minutes[0].t;
  const last = minutes[minutes.length - 1].t;
  return (from, to) => {
    // Ngoài phạm vi dữ liệu thì nói KHÔNG BIẾT, không nói "rỗng".
    if (from < first || to > last + 60_000) return null;
    let lo = 0, hi = minutes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (minutes[mid].t < from) lo = mid + 1; else hi = mid; }
    const res: Candle[] = [];
    for (let i = lo; i < minutes.length && minutes[i].t < to; i++) res.push(minutes[i]);
    return res.length ? res : null;
  };
}
