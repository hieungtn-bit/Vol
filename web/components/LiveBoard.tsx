'use client';

import { useState } from 'react';
import { fmtPct, fmtPrice, fmtUsd } from '@/lib/format';
import type { DirectionalCall } from '@/lib/direct';
import { positioningSplit } from '@/lib/flow';
import type { FlowInfo } from '@/lib/flow';
import type { TF } from '@/lib/types';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];

export interface LiveRow {
  symbol: string;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  direction: Record<TF, DirectionalCall | null>;
  flow: FlowInfo | null;
}

const SIDE_CLS = {
  LONG: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
  SHORT: 'bg-red-500/20 text-red-300 border-red-500/50',
} as const;

const CONV_CLS: Record<string, string> = {
  GOLD: 'bg-amber-300 text-black',
  A: 'bg-white/90 text-black',
  B: 'bg-white/40 text-white',
  C: 'bg-white/15 text-slate-300',
};

const CONV_LABEL: Record<string, string> = { GOLD: '★', A: 'A', B: 'B', C: 'C' };

/** Viền vàng cho badge đạt tín hiệu vàng — phải nhìn phát thấy giữa một bảng đầy hạng C. */
const GOLD_RING = 'ring-2 ring-amber-300 ring-offset-1 ring-offset-panel';

/** Thanh Buy/Sell: xanh trái, đỏ phải, số % ngay trên thanh. */
export function BuySellBar({ buyPct, label }: { buyPct: number | null; label: string }) {
  if (buyPct == null) {
    return (
      <div className="flex items-center gap-2 text-2xs text-muted">
        <span className="w-10 shrink-0">{label}</span>
        <span className="italic">N/A — không dùng làm lý do</span>
      </div>
    );
  }
  const buy = Math.max(0, Math.min(100, buyPct));
  const lean = buy > 53 ? 'text-emerald-300' : buy < 47 ? 'text-red-300' : 'text-slate-300';
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-2xs text-muted">{label}</span>
      <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-red-500/25">
        <div className="h-full bg-emerald-500/45" style={{ width: `${buy}%` }} />
        <div className="absolute inset-0 flex items-center justify-between px-1.5">
          <span className="mono text-[10px] text-emerald-200">{buy.toFixed(1)}%</span>
          <span className="mono text-[10px] text-red-200">{(100 - buy).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function SideBadge({ c, onClick }: { c: DirectionalCall | null; onClick?: () => void }) {
  if (!c) return <div className="rounded border border-line px-1 py-1 text-center text-2xs text-muted">—</div>;
  return (
    <button
      onClick={onClick}
      className={`w-full rounded border px-1 py-1 leading-tight ${SIDE_CLS[c.side]} ${c.golden ? GOLD_RING : ''} hover:brightness-125`}
      title={
        c.golden
          ? `TÍN HIỆU VÀNG · ${c.side} · mọi vế bằng chứng cùng hướng · long ${c.longScore}/short ${c.shortScore}`
          : `${c.side} · hạng ${c.conviction} · long ${c.longScore}/short ${c.shortScore}\nChưa vàng vì: ${c.goldenBlockers.join(' · ')}`
      }
    >
      <div className="flex items-center justify-center gap-1">
        <span className="text-2xs font-bold">{c.side}</span>
        <span className={`rounded px-1 text-[9px] font-bold ${CONV_CLS[c.conviction]}`}>
          {CONV_LABEL[c.conviction]}
        </span>
      </div>
      <div className="mono text-[10px] opacity-80">{c.longScore}/{c.shortScore}</div>
    </button>
  );
}

function FundingChip({ flow }: { flow: FlowInfo | null }) {
  const f = flow?.funding;
  if (!f || f.payer === 'na') return <span className="text-2xs text-muted">funding N/A</span>;
  if (f.payer === 'flat') return <span className="text-2xs text-slate-400">funding phẳng</span>;
  const longPays = f.payer === 'long-pays-short';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-2xs ${longPays ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}>
      {longPays ? 'LONG trả SHORT' : 'SHORT trả LONG'} · {f.annualPct != null ? `${f.annualPct.toFixed(0)}%/năm` : ''}
    </span>
  );
}

/** Bán lẻ vs nhóm lớn. Chỗ hai bên ngược nhau mới là chỗ đáng đọc. */
function PositionChip({ flow }: { flow: FlowInfo | null }) {
  const p = flow?.positioning;
  if (!p || p.retailLongPct == null) return null;
  const split = positioningSplit(p);
  const diff = p.topLongPct != null ? p.topLongPct - p.retailLongPct : null;
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-2xs ${
        diff == null ? 'border-line text-slate-400'
        : diff > 5 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : diff < -5 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-line text-slate-400'}`}
      title={split ?? 'Bán lẻ và nhóm lớn đứng gần như nhau.'}
    >
      lẻ {p.retailLongPct.toFixed(0)}% · lớn {p.topLongPct != null ? `${p.topLongPct.toFixed(0)}%` : 'N/A'} long
      {diff != null && Math.abs(diff) > 5 ? ` (${diff > 0 ? '+' : ''}${diff.toFixed(0)})` : ''}
    </span>
  );
}

function Detail({ c }: { c: DirectionalCall }) {
  const P = (x: number | null) => fmtPrice(x, 0.0001);
  return (
    <div className="rounded-lg border border-line bg-panel2 p-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="mono text-xs font-semibold">{c.tf}</span>
        <span className={`rounded border px-1.5 py-0.5 text-2xs font-bold ${SIDE_CLS[c.side]}`}>{c.side}</span>
        <span className={`rounded px-1 text-[10px] font-bold ${CONV_CLS[c.conviction]}`}>
          {c.golden ? '★ TÍN HIỆU VÀNG' : `hạng ${c.conviction}`}
        </span>
        <span className="text-2xs text-muted">long {c.longScore} · short {c.shortScore}</span>
        <span className="text-2xs text-muted">size {c.size}</span>
      </div>

      <div className="grid gap-x-4 gap-y-0.5 text-2xs sm:grid-cols-2">
        <div className="flex justify-between border-b border-line/60 py-0.5"><span className="text-muted">Entry</span><span className="mono">{P(c.entry[0])} – {P(c.entry[1])}</span></div>
        <div className="flex justify-between border-b border-line/60 py-0.5"><span className="text-muted">SL</span><span className="mono">{P(c.sl)}</span></div>
        <div className="flex justify-between border-b border-line/60 py-0.5"><span className="text-muted">TP1 (50%)</span><span className="mono">{P(c.tp1)}{c.rr1 != null ? ` · RR ${c.rr1.toFixed(2)}` : ''}</span></div>
        <div className="flex justify-between border-b border-line/60 py-0.5"><span className="text-muted">TP2 (30%)</span><span className="mono">{P(c.tp2)}{c.rr2 != null ? ` · RR ${c.rr2.toFixed(2)}` : ''}</span></div>
      </div>

      <p className="mt-1 text-2xs leading-snug text-slate-300"><b>Trigger:</b> {c.trigger}</p>
      <p className="text-2xs leading-snug text-slate-300"><b>Hủy:</b> {c.invalidation}</p>
      <p className="text-2xs leading-snug text-slate-400"><b>Cấu trúc:</b> {c.structureNote}</p>

      <div className="mt-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Bằng chứng</div>
        <ul className="mt-0.5 space-y-0.5">
          {c.evidence.map((e, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-2xs">
              <span className="text-slate-400">
                <span className={`mono mr-1 ${e.points > 0 ? 'text-emerald-400' : e.points < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                  {e.points > 0 ? '+' : ''}{e.points}
                </span>
                {e.label}
              </span>
              <span className="max-w-[60%] text-right text-slate-500">{e.detail}</span>
            </li>
          ))}
        </ul>
      </div>

      {c.golden ? (
        <p className="mt-1.5 rounded border border-amber-300/50 bg-amber-300/10 px-1.5 py-1 text-2xs text-amber-200">
          ★ <b>Tín hiệu vàng</b> — mọi vế bằng chứng có điểm đều cùng chỉ về {c.side}, độ lệch{' '}
          {Math.abs(c.net).toFixed(0)}, RR TP1 {c.rr1?.toFixed(2)}, không cảnh báo nào.
        </p>
      ) : (
        <p className="mt-1.5 text-2xs leading-snug text-slate-500">
          <b>Chưa đạt tín hiệu vàng vì:</b> {c.goldenBlockers.join(' · ')}
        </p>
      )}

      {c.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {c.warnings.map((w, i) => (
            <li key={i} className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-2xs text-red-300">⚠ {w}</li>
          ))}
        </ul>
      )}

      <button
        onClick={() => navigator.clipboard?.writeText(c.planText)}
        className="mt-1.5 rounded border border-line bg-panel px-2 py-0.5 text-2xs hover:brightness-125"
      >
        Copy plan
      </button>
    </div>
  );
}

export function BoardRow({ r }: { r: LiveRow }) {
  const [open, setOpen] = useState<TF | null>(null);
  const bs = 0.0001;

  return (
    <>
      <tr className="align-top">
        <td>
          <div className="mono font-semibold text-sky-300">{r.symbol}</div>
          <div className="mono text-2xs text-muted">{fmtPrice(r.price, bs)}</div>
        </td>
        <td className={`mono text-right ${r.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(r.change24h)}</td>
        <td className="mono text-right text-2xs text-muted">{fmtUsd(r.quoteVolume24h)}</td>
        <td className="min-w-[190px]">
          <div className="space-y-1">
            <BuySellBar buyPct={r.flow?.perpTaker?.buyPct ?? null} label="perp" />
            <BuySellBar buyPct={r.flow?.spotTaker?.buyPct ?? null} label="spot" />
            <div className="flex flex-wrap items-center gap-1.5">
              <FundingChip flow={r.flow} />
              <PositionChip flow={r.flow} />
              {r.flow?.agree && <span className="text-2xs text-emerald-400">đồng thuận</span>}
            </div>
          </div>
        </td>
        {TFS.map((tf) => (
          <td key={tf} className="w-[74px]">
            <SideBadge c={r.direction[tf]} onClick={() => setOpen(open === tf ? null : tf)} />
          </td>
        ))}
      </tr>
      {open && r.direction[open] && (
        <tr>
          <td colSpan={7} className="pb-3">
            <Detail c={r.direction[open]!} />
          </td>
        </tr>
      )}
    </>
  );
}
