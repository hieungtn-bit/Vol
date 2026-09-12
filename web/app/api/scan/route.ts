import { setKhoaHetStore } from '@/lib/lifecycle';
import { taoKhoaHetFile } from '@/lib/khoaHetFile';
import { NextResponse } from 'next/server';
import { ALWAYS_INCLUDE, MAX_SCAN_SYMBOLS } from '@/config/universe';
import { ictString } from '@/lib/format';
import { scanSymbol, sourcesInfo } from '@/lib/scan';
import { saveSnapshot, SNAPSHOT_NOTE } from '@/lib/snapshot';
import { duLieuCu, trangThaiHost, venueState } from '@/lib/sources';
import type { ScanSnapshot, SymbolScan } from '@/lib/types';

// Khoá HẾT dựng MỘT LẦN cho cả module. Có SNAPSHOT_DIR / KHOA_HET_PATH thì ghi
// đĩa; không thì RAM, và `canhBao` đi thẳng vào `degraded`.
const KHOA_HET = taoKhoaHetFile();
setKhoaHetStore(KHOA_HET.store);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Chạy ở Singapore. Region mặc định của Vercel là iad1 (US East) và Binance/OKX
// chặn IP US — deploy vào US thì mọi call sàn trả 451 và trang chỉ còn WAIT rỗng.
export const preferredRegion = 'sin1';


const CONCURRENCY = 4;   // 4 symbol một lượt — đủ nhanh, không đấm exchange

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('symbols');
  const symbols = (raw ? raw.split(',') : ALWAYS_INCLUDE)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{4,20}$/.test(s))
    .slice(0, MAX_SCAN_SYMBOLS);

  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: 'không có symbol hợp lệ' }, { status: 400 });
  }

  const results = await pool(symbols, CONCURRENCY, async (s): Promise<SymbolScan | null> => {
    try {
      return await scanSymbol(s);
    } catch {
      return null;
    }
  });

  const ok = results.filter((r): r is SymbolScan => r !== null);
  const degraded: string[] = [];
  if (venueState.perpAlive === false) {
    degraded.push(`Perp Binance không truy cập được — ${venueState.perpReason} Taker perp = N/A, funding/OI lấy từ OKX.`);
  }
  if (SNAPSHOT_NOTE) degraded.push(SNAPSHOT_NOTE);
  if (KHOA_HET.canhBao) degraded.push(KHOA_HET.canhBao);
  // Host đang bị sàn phạt — nói ra thay vì để người dùng đoán vì sao trang trống.
  for (const h of trangThaiHost()) {
    degraded.push(`${h.host} đang bị Binance phạt, nghỉ thêm ${h.conNghiGiay}s — `
      + 'hệ đã chuyển sang gương khác và dùng bản cũ nếu cần.');
  }
  // Số nào đang là bản CŨ thì ghi rõ cũ bao nhiêu giây. Không có dòng này thì
  // một cái giá 8 phút trước trông y hệt giá live.
  for (const [ten, tuoi] of duLieuCu) {
    degraded.push(`${ten}: đang dùng BẢN CŨ ${Math.round(tuoi / 1000)}s trước (nguồn vừa chết).`);
  }
  for (const r of ok) for (const e of r.errors) degraded.push(`${r.symbol}: ${e}`);

  const snap: ScanSnapshot = {
    ts: Date.now(),
    ictTime: ictString(),
    symbols: ok,
    sources: sourcesInfo(),
    degraded: [...new Set(degraded)],
  };

  if (url.searchParams.get('save') !== '0') void saveSnapshot(snap);

  return NextResponse.json({ ok: true, ...snap });
}
