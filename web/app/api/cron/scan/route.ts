import { NextResponse } from 'next/server';
import { ALWAYS_INCLUDE } from '@/config/universe';
import { ictString } from '@/lib/format';
import { scanSymbol, sourcesInfo } from '@/lib/scan';
import { saveSnapshot } from '@/lib/snapshot';
import type { ScanSnapshot, SymbolScan } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';
export const maxDuration = 60;

/**
 * Điểm móc cho lịch chạy phía server.
 *
 * Vercel Cron trên gói Hobby chỉ bắn được 1 lần/ngày, nên đây KHÔNG phải là
 * "theo dõi liên tục" — muốn liên tục thật thì trỏ một scheduler bên ngoài
 * (GitHub Actions, cron-job.org, uptime monitor…) vào chính URL này với chu kỳ
 * mong muốn. Bản điện ở /live tự làm mới 60s nên vẫn liên tục khi đang mở.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const symbols = (url.searchParams.get('symbols')?.split(',') ?? ALWAYS_INCLUDE)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{4,20}$/.test(s))
    .slice(0, 12);

  const out: SymbolScan[] = [];
  for (const s of symbols) {
    try {
      out.push(await scanSymbol(s));
    } catch {
      /* một symbol hỏng không được làm chết cả lượt quét */
    }
  }

  const snap: ScanSnapshot = {
    ts: Date.now(),
    ictTime: ictString(),
    symbols: out,
    sources: sourcesInfo(),
    degraded: [...new Set(out.flatMap((r) => r.errors.map((e) => `${r.symbol}: ${e}`)))],
  };
  const file = await saveSnapshot(snap);

  // Tóm tắt gọn để đọc thẳng trong log của scheduler, không phải tải cả JSON to.
  const summary = out.map((r) => {
    const d = (r.direction as Record<string, { side: string; conviction: string; longScore: number } | null>)['15m'];
    return d ? `${r.symbol} ${d.side}/${d.conviction} ${d.longScore}` : `${r.symbol} n/a`;
  });

  return NextResponse.json({
    ok: true, ts: snap.ts, ictTime: snap.ictTime,
    scanned: out.length, snapshot: file, summary,
    degraded: snap.degraded,
  });
}
