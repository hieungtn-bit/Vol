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
interface ScannerInfo {
  running: boolean;
  why: string | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  runs: number;
  lastError: string | null;
  symbols: string[];
}

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
  const [sc, setSc] = useState<ScannerInfo | null>(null);
  const [dbNote, setDbNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch(apiPath('scanner'));
        const j = await r.json();
        if (!alive) return;
        setSc(j.scanner ?? null);
        setDbNote(j.db ?? null);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void pull();
    const t = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Không gọi được API trạng thái thì cũng phải nói, chứ không im như thể ổn.
  const bad = failed || !!dbNote || (sc != null && !sc.running) || staleTfs.length > 0;

  const dot = (ok: boolean) =>
    `inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`;

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
        <span className={dot(!!sc?.running)} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <b>Quét nền:</b>{' '}
          {failed
            ? 'không hỏi được trạng thái'
            : sc?.running
              ? `đang chạy · lượt gần nhất ${ago(sc.lastRunAt)} · lượt tới ${inMs(sc.nextRunAt)}`
              : (sc?.why ?? 'chưa bật')}
        </span>
        <span aria-hidden className="shrink-0 text-sm">{open ? '⌄' : '›'}</span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-current/20 px-3 py-2">
          <p className="flex items-start gap-2">
            <span className={dot(!dbNote)} aria-hidden />
            <span>
              <b>Lưu trữ:</b>{' '}
              {dbNote ?? 'SQLite đang ghi nến, từng lần quét, từng tín hiệu và kết quả backtest.'}
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
          {sc?.lastError && <p className="text-amber-300">⚠ Lượt gần nhất: {sc.lastError}</p>}
          {sc?.running && (
            <p className="text-muted">
              Quét theo NẾN ĐÓNG chứ không theo đồng hồ — mọi đầu vào đều lấy từ nến đã đóng,
              nên quét dày hơn không đẻ ra thông tin mới. Đã chạy {sc.runs} lượt, {sc.symbols.length} mã.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
