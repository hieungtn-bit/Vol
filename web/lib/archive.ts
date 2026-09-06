import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle } from './types';

// ============================================================
// KHO DỮ LIỆU CÔNG KHAI CỦA BINANCE (data.binance.vision)
//
// Blocker "phải vào được fapi mới kiểm chứng được" là SAI. fapi trả 451 từ môi
// trường này, nhưng kho lưu trữ công khai thì mở, và nó phục vụ đủ cả bốn thứ
// backtest đang thiếu:
//   · futures UM klines  → taker_buy_volume  (delta perp thật)
//   · fundingRate        → funding ĐÃ CHỐT + funding_interval_hours
//   · metrics            → sum_open_interest (OI theo thời gian)
//   · spot klines        → taker spot
//
// BẪY ĐƠN VỊ ĐÃ KIỂM: klines SPOT trong kho dùng MICROgiây (16 chữ số), klines
// FUTURES dùng MILIgiây (13 chữ số). Trộn hai thứ này thì mọi phép cắt lát theo
// thời gian đều sai mà không báo lỗi. Hàm dưới chuẩn hoá theo độ lớn.
// ============================================================

const BASE = 'https://data.binance.vision/data';
const CACHE = process.env.ARCHIVE_CACHE ?? '/tmp/binance-archive';

export interface Manifest {
  url: string;
  bytes: number;
  sha256: string;
  rows: number;
}

const manifests: Manifest[] = [];
export const archiveManifest = () => [...manifests];

/** Chuẩn hoá timestamp về mili giây, bất kể kho trả giây / mili / micro. */
export function toMs(x: number): number {
  const a = Math.abs(x);
  if (a > 1e17) return Math.round(x / 1e6);   // nano
  if (a > 1e14) return Math.round(x / 1e3);   // micro
  if (a > 1e11) return x;                     // mili
  return x * 1000;                            // giây
}

function fetchZipCsv(path: string): string[] | null {
  mkdirSync(CACHE, { recursive: true });
  const url = `${BASE}/${path}`;
  const zip = join(CACHE, path.replace(/[/]/g, '_'));
  if (!existsSync(zip)) {
    try {
      execFileSync('curl', ['-sfL', '--max-time', '90', '-o', zip, url], { stdio: 'ignore' });
    } catch { return null; }
  }
  if (!existsSync(zip)) return null;
  const buf = readFileSync(zip);
  if (buf.length < 100 || buf[0] !== 0x50) return null;   // không phải zip
  let csv: string;
  try {
    csv = execFileSync('unzip', ['-p', zip], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
  } catch { return null; }
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  // Bỏ dòng tiêu đề nếu có (một số tập có, một số không).
  const body = /^[a-zA-Z_]/.test(lines[0]) ? lines.slice(1) : lines;
  manifests.push({
    url, bytes: buf.length, rows: body.length,
    sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16),
  });
  return body;
}

const days = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};

/** Klines từ kho. `market` = 'um' (futures USD-M) hoặc 'spot'. */
export function archiveKlines(
  market: 'um' | 'spot',
  symbol: string,
  interval: string,
  from: string,
  to: string,
): Candle[] {
  const out: Candle[] = [];
  const prefix = market === 'um' ? 'futures/um' : 'spot';
  for (const d of days(from, to)) {
    const rows = fetchZipCsv(`${prefix}/daily/klines/${symbol}/${interval}/${symbol}-${interval}-${d}.zip`);
    if (!rows) continue;
    for (const line of rows) {
      const f = line.split(',');
      const v = +f[5];
      out.push({
        t: toMs(+f[0]), o: +f[1], h: +f[2], l: +f[3], c: +f[4],
        v, q: +f[7], takerBuyBase: Number.isFinite(+f[9]) ? +f[9] : null, closed: true,
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export interface FundingRow { calcTime: number; intervalHours: number; rate: number }

/**
 * Funding ĐÃ CHỐT. `calc_time` là lúc kỳ được tính xong, nên chỉ những hàng có
 * `calcTime <= thời điểm quyết định` mới được dùng — kỳ dự kiến chưa chốt là
 * thông tin của tương lai.
 */
export function archiveFunding(symbol: string, months: string[]): FundingRow[] {
  const out: FundingRow[] = [];
  for (const m of months) {
    const rows = fetchZipCsv(`futures/um/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${m}.zip`);
    if (!rows) continue;
    for (const line of rows) {
      const f = line.split(',');
      out.push({ calcTime: toMs(+f[0]), intervalHours: +f[1] || 8, rate: +f[2] });
    }
  }
  out.sort((a, b) => a.calcTime - b.calcTime);
  return out;
}

export interface OIRow { t: number; oi: number; oiValue: number; topLongShort: number | null }

export function archiveOI(symbol: string, from: string, to: string): OIRow[] {
  const out: OIRow[] = [];
  for (const d of days(from, to)) {
    const rows = fetchZipCsv(`futures/um/daily/metrics/${symbol}/${symbol}-metrics-${d}.zip`);
    if (!rows) continue;
    for (const line of rows) {
      const f = line.split(',');
      const t = Date.parse(f[0].replace(' ', 'T') + 'Z');
      if (!Number.isFinite(t)) continue;
      out.push({
        t, oi: +f[2], oiValue: +f[3],
        topLongShort: Number.isFinite(+f[4]) ? +f[4] : null,
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Tra hàng gần nhất KHÔNG vượt quá `at`. Đây là chỗ chặn nhìn trộm tương lai. */
export function asOfRow<T extends { t?: number; calcTime?: number }>(rows: T[], at: number): T | null {
  let lo = 0; let hi = rows.length - 1; let ans: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ts = (rows[mid].t ?? rows[mid].calcTime)!;
    if (ts <= at) { ans = rows[mid]; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}
