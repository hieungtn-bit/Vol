import { NextResponse } from 'next/server';
import { listSnapshots, readSnapshot } from '@/lib/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Chạy ở Singapore. Region mặc định của Vercel là iad1 (US East) và Binance/OKX
// chặn IP US — deploy vào US thì mọi call sàn trả 451 và trang chỉ còn WAIT rỗng.
export const preferredRegion = 'sin1';


export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name');
  if (name) {
    const snap = await readSnapshot(name);
    if (!snap) return NextResponse.json({ ok: false, error: 'không tìm thấy snapshot' }, { status: 404 });
    return NextResponse.json({ ok: true, snapshot: snap });
  }
  return NextResponse.json({ ok: true, files: await listSnapshots() });
}
