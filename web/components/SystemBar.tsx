'use client';

import { useEffect, useState } from 'react';
import { apiPath } from '@/config/site';

/**
 * TRẠNG THÁI HỆ THỐNG — ba câu hỏi luôn phải trả lời được ngay trên màn hình:
 *
 *   1. Quét nền còn chạy không, hay đã chết mà không ai biết?
 *   2. Lịch sử có đang được lưu không, hay đang chạy mà vứt hết?
 *   3. Có khung nào đang đọc trên nến CŨ không?
 *
 * Cả ba đều là thứ mà khi hỏng thì màn hình vẫn đầy số và trông vẫn bình thường.
 * Đó chính là lý do chúng phải có chỗ cố định, chứ không phải chỉ hiện lúc lỗi.
 */
interface LastScan {
  id: number; ts: number; ictTime: string; trigger: string;
  durationMs: number; symbols: number; degraded: string[];
}
interface Health {
  lastScan: LastScan | null;
  stale: boolean;
  local: { running: boolean; why: string | null; runs: number; lastError: string | null; symbols: string[] };
  db: string | null;
}

const TRIGGER_VI: Record<string, string> = {
  nen: 'tự động khi nến đóng',
  'thu-cong': 'chạy tay',
  cron: 'lịch server',
};

function ago(ts: number | null): string {
  if (!ts) return 'chưa lần nào';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  return `${Math.round(s / 3600)} giờ trước`;
}

function inMs(ts: number | null): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000));
  return s < 60 ? `${s}s nữa` : `${Math.round(s / 60)} phút nữa`;
}

export function SystemBar({ staleTfs }: { staleTfs: string[] }) {
  const [h, setH] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch(apiPath('scanner'));
        const j = (await r.json()) as Health & { ok: boolean };
        if (!alive) return;
        setH(j);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void pull();
    const t = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const bad = failed || !!h?.db || h?.stale !== false || staleTfs.length > 0;

  const dot = (ok: boolean) =>
    `inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`;

  // Câu tóm tắt nói về LƯỢT QUÉT ĐÃ XẢY RA, không nói về một biến đang bật.
  // Một bộ hẹn giờ còn sống mà mọi lượt đều ném lỗi thì "đang chạy" là câu sai.
  const summary = failed
    ? 'không hỏi được trạng thái'
    : h?.db
      ? h.db
      : h?.lastScan
        ? `lượt gần nhất ${ago(h.lastScan.ts)} (${TRIGGER_VI[h.lastScan.trigger] ?? h.lastScan.trigger})`
          + `${h.stale ? ' — QUÁ HẠN, chưa có lượt mới sau hai nến 15m' : ''}`
        : 'chưa có lượt quét nào được ghi lại';

  return (
    <div
      className={`mb-3 rounded-lg border text-2xs leading-snug ${
        bad ? 'border-amber-400/40 bg-amber-400/10 text-amber-100' : 'border-line bg-panel2 text-muted'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tap-sm flex w-full items-center gap-2 px-3 text-left"
      >
        <span className={dot(!bad)} aria-hidden />
        <span className="min-w-0 flex-1 truncate"><b>Quét nền:</b> {summary}</span>
        <span aria-hidden className="shrink-0 text-sm">{open ? '⌄' : '›'}</span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-current/20 px-3 py-2">
          <p className="flex items-start gap-2">
            <span className={dot(!h?.db)} aria-hidden />
            <span>
              <b>Lưu trữ:</b>{' '}
              {h?.db ?? 'SQLite đang ghi nến, từng lần quét, từng tín hiệu và kết quả backtest.'}
            </span>
          </p>
          <p className="flex items-start gap-2">
            <span className={dot(staleTfs.length === 0)} aria-hidden />
            <span>
              <b>Dữ liệu:</b>{' '}
              {staleTfs.length === 0
                ? 'mọi khung đang đọc trên nến đã đóng.'
                : `${staleTfs.length} khung đang đọc trên nến CŨ (${staleTfs.join(', ')}) — hướng vẫn hiện nhưng không phải kèo để đặt tiền.`}
            </span>
          </p>
          {h?.lastScan && (
            <p className="text-muted">
              Lượt #{h.lastScan.id} lúc {h.lastScan.ictTime} · {h.lastScan.symbols} mã ·{' '}
              {(h.lastScan.durationMs / 1000).toFixed(1)}s
              {h.lastScan.degraded.length > 0 ? ` · ${h.lastScan.degraded.length} nguồn thiếu` : ''}
            </p>
          )}
          {h?.local.lastError && <p className="text-amber-300">⚠ Lượt gần nhất: {h.local.lastError}</p>}
          <p className="text-muted">
            Quét theo NẾN ĐÓNG chứ không theo đồng hồ — mọi đầu vào đều lấy từ nến đã đóng, nên
            quét dày hơn không đẻ ra thông tin mới.
          </p>
        </div>
      )}
    </div>
  );
}
