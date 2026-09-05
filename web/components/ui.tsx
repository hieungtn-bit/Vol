'use client';

import type { Bias, Recommendation, SizeHint, Stage } from '@/lib/types';

export const BIAS_CLASS: Record<Bias, string> = {
  LONG: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/40',
  SHORT: 'bg-red-600/20 text-red-300 border-red-600/40',
  WAIT: 'bg-slate-600/20 text-slate-300 border-slate-600/40',
};

export const STAGE_VI: Record<Stage, string> = {
  'edge-fail': 'fail mép trên',
  'edge-hold': 'giữ mép dưới',
  breakdown: 'đóng thủng',
  breakout: 'đóng vượt',
  'mid-range': 'không có mép',
};

export function BiasBadge({
  r, onClick, stacked,
}: {
  r: Recommendation; onClick?: () => void;
  /** Dạng thẻ trên điện thoại: cao đủ ngón tay và có nhãn khung ở trên. */
  stacked?: boolean;
}) {
  const lean =
    r.bias === 'WAIT' && r.confluence.score >= 4
      ? r.stage === 'edge-fail' || r.stage === 'breakdown' ? '↓' : r.stage === 'mid-range' ? '' : '↑'
      : '';
  const label = `${r.tf}: ${r.bias}${r.counterTrend && r.bias !== 'WAIT' ? ' counter-trend' : ''}, `
    + `${STAGE_VI[r.stage]}, điểm ${r.confluence.score.toFixed(1)} trên 10`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={onClick ? `${label}. Bấm để mở chi tiết.` : label}
      className={[
        'flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 leading-none',
        stacked ? 'tap min-h-tap' : 'tap-sm min-h-[38px]',
        BIAS_CLASS[r.bias],
        onClick ? 'cursor-pointer active:brightness-125 hover:brightness-125' : '',
      ].join(' ')}
    >
      {stacked && <span className="mono text-[10px] uppercase tracking-wide opacity-70">{r.tf}</span>}
      <span className="whitespace-nowrap text-[11px] font-bold">
        {r.bias === 'WAIT' ? `WAIT${lean}` : r.bias}
        {r.counterTrend && r.bias !== 'WAIT' ? '*' : ''}
      </span>
      <span className="mono whitespace-nowrap text-[10px] opacity-75">{r.confluence.score.toFixed(1)}</span>
    </button>
  );
}

export function SizePill({ size, counter }: { size: SizeHint; counter: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-2xs border ${
      size === 'Small' ? 'border-amber-600/40 bg-amber-600/10 text-amber-300'
                       : 'border-sky-600/40 bg-sky-600/10 text-sky-300'}`}>
      Size {size}{counter ? ' · counter-trend' : ''}
    </span>
  );
}

export function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-red-600/40 bg-red-600/10 px-2 py-1 text-2xs text-red-300">
      ⚠ {children}
    </div>
  );
}

export function Field({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5">
      <span className="shrink-0 text-2xs text-muted">{label}</span>
      <span className={`min-w-0 text-right text-xs ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * VP mini: thanh ngang VA + POC + vị trí giá hiện tại. Không phải chart, chỉ để định vị.
 *
 * Bản trước đặt tên của TỪNG vạch trong thuộc tính `title` — POC, HVN, LVN, giá
 * hiện tại. Trên điện thoại không rê chuột được, nên cả hình chỉ còn là mấy vạch
 * màu vô nghĩa. Giờ có chú giải bằng chữ ngay dưới, và cả khối có nhãn cho trình
 * đọc màn hình.
 */
export function VPMini({ r }: { r: Recommendation }) {
  const { vaLow, vaHigh, poc, last } = r.vp;
  const lo = Math.min(vaLow, last, ...r.vp.lvn, ...r.vp.hvn);
  const hi = Math.max(vaHigh, last, ...r.vp.lvn, ...r.vp.hvn);
  const span = hi - lo || 1;
  const pos = (x: number) => `${Math.max(0, Math.min(100, ((x - lo) / span) * 100))}%`;

  return (
    <div className="mt-1">
    <div
      className="relative h-8 w-full rounded bg-panel2"
      role="img"
      aria-label={`Value area ${vaLow} đến ${vaHigh}, POC ${poc}, giá hiện tại ${last}`}
    >
      <div
        className="absolute inset-y-1 rounded bg-sky-500/15 border border-sky-500/30"
        style={{ left: pos(vaLow), width: `calc(${pos(vaHigh)} - ${pos(vaLow)})` }}
        title={`VA70 ${vaLow} – ${vaHigh}`}
      />
      {r.vp.hvn.map((p) => (
        <div key={`h${p}`} className="absolute inset-y-2 w-px bg-amber-400/60" style={{ left: pos(p) }} title={`HVN ${p}`} />
      ))}
      {r.vp.lvn.map((p) => (
        <div key={`l${p}`} className="absolute inset-y-3 w-px bg-slate-500/60" style={{ left: pos(p) }} title={`LVN ${p}`} />
      ))}
      <div className="absolute inset-y-0 w-0.5 bg-fuchsia-400" style={{ left: pos(poc) }} title={`POC ${poc}`} />
      <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pos(last) }} title={`Giá ${last}`} />
    </div>
      <ul className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-muted">
        <li className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-sky-500/40 ring-1 ring-sky-500/50" aria-hidden />VA</li>
        <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-0.5 bg-fuchsia-400" aria-hidden />POC</li>
        <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-0.5 bg-white" aria-hidden />giá</li>
        <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-0.5 bg-amber-400/60" aria-hidden />HVN</li>
        <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-0.5 bg-slate-500/60" aria-hidden />LVN</li>
      </ul>
    </div>
  );
}
