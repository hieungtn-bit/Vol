'use client';

import { useState } from 'react';
import type { TFRead } from '@/lib/tfRead';

// ============================================================
// Hiển thị một khung theo hợp đồng mới.
//
// Luật cứng của UI: `plan === null` thì KHÔNG được vẽ mũi tên mua/bán, không
// được in mức giá. Chỉ hiện "đứng ngoài + lý do + mép cần đóng để xem lại".
// Bản trước in đủ entry/SL/TP ở điểm 2/10, và người đọc không có cách nào biết
// bộ số đó không đáng vào tiền.
// ============================================================

const STATE_LABEL: Record<TFRead['state'], string> = {
  trong_vung: 'còn trong vùng',
  chap_nhan_ngoai: 'chấp nhận ngoài vùng',
  vung_dich: 'vùng giá trị dịch',
};

const BIAS_LABEL: Record<TFRead['bias'], string> = {
  dung_ngoai: 'đứng ngoài',
  mua: 'mở mua',
  ban: 'mở bán',
};

const BIAS_CLS: Record<TFRead['bias'], string> = {
  dung_ngoai: 'border-slate-500/50 bg-slate-500/10 text-slate-300',
  mua: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
  ban: 'border-red-500/50 bg-red-500/15 text-red-300',
};

const SIZE_LABEL = { kho_nua: 'khổ nửa', kho_du: 'khổ đủ' } as const;

const LAYER_LABEL: Record<TFRead['layer'], string> = {
  '10d': '10 ngày', '48h': '48 giờ', '24h': '24 giờ',
  after_event: 'sau-event', session_4h: 'phiên 4 giờ',
};

export function TFTile({ r, open, onToggle }: { r: TFRead; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${r.tf}: ${BIAS_LABEL[r.bias]}, ${STATE_LABEL[r.state]}, điểm ${r.score}`}
      className={`tap flex min-h-tap w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 leading-none ${BIAS_CLS[r.bias]} ${open ? 'ring-1 ring-sky-400/70' : ''} active:brightness-125`}
    >
      <span className="mono text-[10px] uppercase tracking-wide opacity-70">{r.tf}</span>
      <span className="whitespace-nowrap text-[11px] font-bold">{BIAS_LABEL[r.bias]}</span>
      <span className="mono whitespace-nowrap text-[10px] opacity-75">{r.score.toFixed(1)}</span>
    </button>
  );
}

export function TFDetail({ r }: { r: TFRead }) {
  const [showLines, setShowLines] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-panel2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mono rounded bg-white/10 px-1.5 py-0.5 text-xs font-semibold">{r.tf}</span>
        <span className={`rounded border px-2 py-0.5 text-2xs font-bold ${BIAS_CLS[r.bias]}`}>
          {BIAS_LABEL[r.bias]}
        </span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">
          {STATE_LABEL[r.state]}
        </span>
        <span className="text-2xs text-muted">lớp {LAYER_LABEL[r.layer]}</span>
        <span className="mono text-2xs text-muted">điểm {r.score.toFixed(1)}</span>
      </div>

      <p className="mb-2 rounded-md border border-line bg-panel/60 px-2 py-1.5 text-2xs leading-snug text-slate-300">
        {r.state_text}
      </p>

      <div className="grid gap-x-5 text-2xs sm:grid-cols-2">
        <Row k="Điểm kiểm soát" v={`${r.poc[0]} – ${r.poc[1]}`} />
        <Row k="Vùng giá trị" v={`${r.val} – ${r.vah}`} />
      </div>

      {r.plan ? (
        <div className="mt-2">
          <div className="grid gap-x-5 text-2xs sm:grid-cols-2">
            <Row k="Vào" v={`${r.plan.entry[0]} – ${r.plan.entry[1]}`} />
            <Row k="Cắt" v={<span className="text-red-300">{r.plan.sl}</span>} />
            <Row k="Chốt 1 (50%)" v={<span className="text-emerald-300">{r.plan.tp1}</span>} />
            <Row k="Chốt 2 (30%)" v={<span className="text-emerald-300">{r.plan.tp2}</span>} />
            <Row k="Khổ lệnh" v={SIZE_LABEL[r.plan.size]} />
          </div>
          <p className="mt-1.5 text-2xs leading-snug text-slate-300">
            <b className="text-slate-400">Kích hoạt:</b> {r.plan.trigger}
          </p>
        </div>
      ) : (
        <div className="mt-2 rounded-md border border-slate-500/40 bg-slate-500/10 px-2 py-1.5">
          <p className="text-2xs font-semibold text-slate-200">Đứng ngoài — không in mức giá.</p>
          <ul className="mt-1 space-y-0.5 text-2xs leading-snug text-slate-400">
            {r.gate.fail_reasons.map((x, i) => <li key={i}>– {x}</li>)}
          </ul>
          <p className="mt-1.5 text-2xs leading-snug text-sky-300">{r.watch}</p>
        </div>
      )}

      {r.delta_div && (
        <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-2xs text-amber-200">
          Phân kỳ delta: {r.delta_div.type} · {r.delta_div.status}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowLines((v) => !v)}
        className="tap-sm mt-2 w-full rounded-lg border border-line bg-panel px-3 text-2xs font-semibold text-slate-300 active:brightness-125"
      >
        {showLines ? 'Ẩn bảng điểm' : 'Bảng điểm hợp lưu'}
      </button>
      {showLines && (
        <ul className="mt-1.5 space-y-1">
          {r.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-2xs">
              <span className="text-slate-400">{l.label}</span>
              <span className={`mono ${l.points >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {l.points >= 0 ? '+' : ''}{l.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5">
      <span className="shrink-0 text-2xs text-muted">{k}</span>
      <span className="mono text-right text-xs">{v}</span>
    </div>
  );
}
