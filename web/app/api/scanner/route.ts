import { NextResponse } from 'next/server';
import { dbNote } from '@/lib/db';
import { runOnce, scannerState, startScanner } from '@/lib/scanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';
export const maxDuration = 60;

/** Quét nền đang sống hay đang chết, và nếu chết thì vì sao. */
export async function GET() {
  return NextResponse.json({ ok: true, scanner: scannerState(), db: dbNote() });
}

/**
 * Chạy một lượt ngay, không đợi nến đóng.
 *
 * Cùng đường code với lượt tự động — nếu tay và tự động chạy hai đường khác nhau
 * thì thứ kiểm tra được bằng tay không phải thứ đang chạy nền.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  startScanner();
  const id = await runOnce('thu-cong');
  return NextResponse.json({ ok: true, scanId: id, scanner: scannerState(), db: dbNote() });
}
