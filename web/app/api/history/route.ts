import { NextResponse } from 'next/server';
import { dbNote, recentBacktests, recentScans, signalHistory, signalsOfScan } from '@/lib/db';
import type { TF } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];

/**
 * Lịch sử đã lưu.
 *
 *   /api/history                       → các lần quét gần đây
 *   /api/history?scan=12               → mọi tín hiệu của lần quét 12
 *   /api/history?symbol=ENAUSDT&tf=1h  → hệ đã đổi ý lúc nào trên cặp đó
 *   /api/history?backtests=1           → các lần backtest kèm cấu hình và dấu dữ liệu
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const note = dbNote();
  if (note) return NextResponse.json({ ok: false, error: note }, { status: 503 });

  const limit = Math.min(500, Math.max(1, Number(q.get('limit') ?? 100)));

  if (q.get('backtests')) return NextResponse.json({ ok: true, backtests: recentBacktests(limit) });

  const scan = q.get('scan');
  if (scan) {
    const id = Number(scan);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'scan không hợp lệ' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, signals: signalsOfScan(id) });
  }

  const symbol = q.get('symbol');
  if (symbol) {
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
      return NextResponse.json({ ok: false, error: 'symbol không hợp lệ' }, { status: 400 });
    }
    const tf = (q.get('tf') ?? '1h') as TF;
    if (!TFS.includes(tf)) {
      return NextResponse.json({ ok: false, error: 'tf không hợp lệ' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, signals: signalHistory(symbol, tf, limit) });
  }

  return NextResponse.json({ ok: true, scans: recentScans(limit) });
}
