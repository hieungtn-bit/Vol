import { NextResponse } from 'next/server';
import { listSnapshots, readSnapshot } from '@/lib/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name');
  if (name) {
    const snap = await readSnapshot(name);
    if (!snap) return NextResponse.json({ ok: false, error: 'không tìm thấy snapshot' }, { status: 404 });
    return NextResponse.json({ ok: true, snapshot: snap });
  }
  return NextResponse.json({ ok: true, files: await listSnapshots() });
}
