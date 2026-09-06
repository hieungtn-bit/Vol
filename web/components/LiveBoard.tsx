'use client';

import { useState } from 'react';
import { fmtPct, fmtTick, fmtUsd } from '@/lib/format';
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
  LONG: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/45',
  SHORT: 'bg-red-500/15 text-red-300 border-red-500/45',
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

const P4 = fmtTick;

/**
 * Một dòng chữ nói TRẠNG THÁI CỬA.
 *
 * Trước đây câu này chỉ nằm trong thuộc tính `title`, tức tooltip khi rê chuột.
 * Trên điện thoại không có con trỏ để rê, nên toàn bộ lý do một kèo bị loại
 * biến mất — người dùng chỉ thấy một badge mờ đi mà không biết vì sao. Bây giờ
 * nó là chữ thật, đọc được bằng ngón tay lẫn bằng trình đọc màn hình.
 */
export function GateLine({ c, className = '' }: { c: DirectionalCall; className?: string }) {
  return c.tradeable ? (
    <p className={`rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-1.5 text-2xs leading-snug text-emerald-200 ${className}`}>
      <b>Qua cửa chất lượng.</b> Mọi vế cùng hướng · hạng {c.conviction} · R kỳ vọng{' '}
      {c.rrBlended?.toFixed(2) ?? 'N/A'} ≤ 1.5 · stop đủ rộng để phí không ăn quá 10% của 1R.
    </p>
  ) : (
    <p className={`rounded-md border border-slate-500/40 bg-slate-500/10 px-2 py-1.5 text-2xs leading-snug text-slate-300 ${className}`}>
      <b>Trượt cửa — chỉ theo dõi, không vào tiền.</b> Hướng vẫn là {c.side}, nhưng:
      <span className="mt-1 block space-y-0.5">
        {c.gateBlockers.map((b, i) => <span key={i} className="block">– {b}</span>)}
      </span>
    </p>
  );
}

/** Thanh Buy/Sell: xanh trái, đỏ phải, số % ngay trên thanh. */
export function BuySellBar({ buyPct, label }: { buyPct: number | null; label: string }) {
  if (buyPct == null) {
    return (
      <div className="flex items-center gap-2 text-2xs text-muted">
        <span className="w-9 shrink-0">{label}</span>
        <span className="italic">N/A — không dùng làm lý do</span>
      </div>
    );
  }
  const buy = Math.max(0, Math.min(100, buyPct));
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-2xs text-muted">{label}</span>
      <div
        className="relative h-4 flex-1 overflow-hidden rounded bg-red-500/25"
        role="img"
        aria-label={`${label}: ${buy.toFixed(1)}% mua, ${(100 - buy).toFixed(1)}% bán`}
      >
        <div className="h-full bg-emerald-500/45" style={{ width: `${buy}%` }} />
        <div className="absolute inset-0 flex items-center justify-between px-1.5">
          <span className="mono text-[10px] text-emerald-200">{buy.toFixed(1)}%</span>
          <span className="mono text-[10px] text-red-200">{(100 - buy).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

export function FundingChip({ flow }: { flow: FlowInfo | null }) {
  const f = flow?.funding;
  if (!f || f.payer === 'na') return <span className="text-2xs text-muted">funding N/A</span>;
  if (f.payer === 'flat') return <span className="text-2xs text-slate-400">funding phẳng</span>;
  const longPays = f.payer === 'long-pays-short';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-2xs ${longPays ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}>
      {longPays ? 'LONG trả SHORT' : 'SHORT trả LONG'}
      {f.annualPct != null ? ` · ${f.annualPct.toFixed(0)}%/năm` : ''}
    </span>
  );
}

/** Bán lẻ vs nhóm lớn. Chỗ hai bên ngược nhau mới là chỗ đáng đọc. */
export function PositionChip({ flow }: { flow: FlowInfo | null }) {
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

export function FlowBlock({ flow }: { flow: FlowInfo | null }) {
  return (
    <div className="space-y-1.5">
      <BuySellBar buyPct={flow?.perpTaker?.buyPct ?? null} label="perp" />
      <BuySellBar buyPct={flow?.spotTaker?.buyPct ?? null} label="spot" />
      <div className="flex flex-wrap items-center gap-1.5">
        <FundingChip flow={flow} />
        <PositionChip flow={flow} />
        {flow?.agree && <span className="text-2xs text-emerald-400">đồng thuận</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Ô một khung thời gian
// ------------------------------------------------------------

/**
 * Ô bấm của một khung. Dùng chung cho cả thẻ mobile lẫn bảng desktop, nhưng
 * mobile cần cao ít nhất 44px — dưới mức đó là bấm trượt sang ô bên cạnh.
 */
function TFCell({
  tf, c, open, onToggle, stacked,
}: {
  tf: TF; c: DirectionalCall | null; open: boolean; onToggle: () => void; stacked?: boolean;
}) {
  if (!c) {
    return (
      <div className={`flex ${stacked ? 'min-h-tap' : 'min-h-[38px]'} flex-col items-center justify-center rounded-lg border border-line/70 text-2xs text-muted`}>
        {stacked && <span className="mono mb-0.5 text-[10px] uppercase tracking-wide opacity-70">{tf}</span>}
        —
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${tf}: ${c.side}, hạng ${c.conviction}, ${c.tradeable ? 'qua cửa' : 'trượt cửa'}. Bấm để xem kế hoạch.`}
      className={[
        'tap flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 leading-none transition',
        stacked ? 'min-h-tap' : 'min-h-[38px]',
        SIDE_CLS[c.side],
        c.golden ? GOLD_RING : '',
        c.tradeable ? '' : 'opacity-50',
        open ? 'brightness-125 ring-1 ring-sky-400/70' : '',
        'active:brightness-125 hover:brightness-125',
      ].join(' ')}
    >
      {stacked && <span className="mono text-[10px] uppercase tracking-wide opacity-70">{tf}</span>}
      <span className="flex items-center gap-1 whitespace-nowrap">
        <span className="text-[11px] font-bold tracking-tight">{c.side}</span>
        <span className={`rounded px-1 text-[9px] font-bold leading-4 ${CONV_CLS[c.conviction]}`}>
          {CONV_LABEL[c.conviction]}
        </span>
      </span>
      {/*
        Chữ ở đây KHÔNG được phép xuống dòng. "qua cửa" bị ngắt giữa chừng thì dấu
        tiếng Việt vỡ ra thành "cưả" — nên dấu qua cửa chỉ còn một ký tự, còn tỷ số
        long/short thì luôn hiện vì nó mới là số người ta so giữa các khung.
      */}
      <span className="mono flex items-center gap-1 whitespace-nowrap text-[10px] opacity-75">
        {c.tradeable && <span className="text-emerald-300" aria-hidden>✓</span>}
        {c.longScore}/{c.shortScore}
      </span>
    </button>
  );
}

// ------------------------------------------------------------
// Chi tiết một kèo
// ------------------------------------------------------------

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5">
      <span className="shrink-0 text-2xs text-muted">{k}</span>
      <span className="mono text-right text-xs">{v}</span>
    </div>
  );
}

export function Detail({ c }: { c: DirectionalCall }) {
  return (
    <div className="rounded-xl border border-line bg-panel2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mono rounded bg-white/10 px-1.5 py-0.5 text-xs font-semibold">{c.tf}</span>
        <span className={`rounded border px-2 py-0.5 text-2xs font-bold ${SIDE_CLS[c.side]}`}>{c.side}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${CONV_CLS[c.conviction]}`}>
          {c.golden ? '★ TÍN HIỆU VÀNG' : `hạng ${c.conviction}`}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${c.tradeable ? 'bg-emerald-400/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
          {c.tradeable ? 'QUA CỬA' : 'CHỈ THEO DÕI'}
        </span>
        <span className="text-2xs text-muted">size {c.size}</span>
      </div>

      <GateLine c={c} className="mb-2" />

      {/* Mức giá là thứ người ta mở ra để xem — đặt trước mọi thứ khác. */}
      <div className="grid gap-x-5 sm:grid-cols-2">
        <Row k="Entry" v={`${P4(c.entry[0])} – ${P4(c.entry[1])}`} />
        <Row k="SL" v={<span className="text-red-300">{P4(c.sl)}</span>} />
        <Row k="TP1 · chốt 50%" v={<><span className="text-emerald-300">{P4(c.tp1)}</span>{c.rr1 != null ? <span className="text-muted"> · RR {c.rr1.toFixed(2)}</span> : null}</>} />
        <Row k="TP2 · chốt 30%" v={<><span className="text-emerald-300">{P4(c.tp2)}</span>{c.rr2 != null ? <span className="text-muted"> · RR {c.rr2.toFixed(2)}</span> : null}</>} />
        <Row k="R kỳ vọng" v={c.rrBlended != null ? c.rrBlended.toFixed(2) : 'N/A'} />
        <Row k="Long / Short" v={`${c.longScore} / ${c.shortScore}`} />
      </div>

      <div className="mt-2 space-y-1 text-2xs leading-relaxed">
        <p className="text-slate-300"><b className="text-slate-400">Trigger:</b> {c.trigger}</p>
        <p className="text-slate-300"><b className="text-slate-400">Hủy khi:</b> {c.invalidation}</p>
        <p className="text-slate-400"><b>Cấu trúc:</b> {c.structureNote}</p>
      </div>

      {c.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {c.warnings.map((w, i) => (
            <li key={i} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-2xs leading-snug text-amber-200">⚠ {w}</li>
          ))}
        </ul>
      )}

      <details className="mt-2 rounded-lg border border-line bg-panel/60">
        <summary className="tap-sm flex items-center justify-between px-2.5 py-2 text-2xs font-semibold uppercase tracking-wide text-muted">
          Bằng chứng chấm điểm
          <span aria-hidden className="text-sm leading-none">›</span>
        </summary>
        <ul className="space-y-1.5 border-t border-line px-2.5 py-2">
          {c.evidence.map((e, i) => (
            <li key={i} className="text-2xs leading-snug">
              <div className="flex items-baseline gap-2">
                <span className={`mono w-9 shrink-0 text-right font-semibold ${e.points > 0 ? 'text-emerald-400' : e.points < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                  {e.points > 0 ? '+' : ''}{e.points}
                </span>
                <span className="text-slate-300">{e.label}</span>
              </div>
              <div className="pl-11 text-slate-500">{e.detail}</div>
            </li>
          ))}
        </ul>
        {!c.golden && (
          <p className="border-t border-line px-2.5 py-2 text-2xs leading-snug text-slate-500">
            <b>Chưa đạt tín hiệu vàng vì:</b> {c.goldenBlockers.join(' · ')}
          </p>
        )}
      </details>

      <CopyPlan text={c.planText} />
    </div>
  );
}

function CopyPlan({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch { /* clipboard bị chặn — không làm gì, nút vẫn giữ nguyên chữ */ }
      }}
      className="tap mt-2 w-full rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-slate-200 active:brightness-125 hover:brightness-125"
    >
      {done ? '✓ Đã copy kế hoạch' : 'Copy kế hoạch'}
    </button>
  );
}

// ------------------------------------------------------------
// Mobile: một thẻ cho mỗi mã
// ------------------------------------------------------------

export function SymbolCard({ r }: { r: LiveRow }) {
  const [open, setOpen] = useState<TF | null>(null);
  const up = r.change24h >= 0;

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex items-baseline justify-between gap-3 px-3 pt-3">
        <div className="min-w-0">
          <h3 className="mono truncate text-sm font-semibold text-sky-300">{r.symbol}</h3>
          <p className="text-2xs text-muted">vol 24h {fmtUsd(r.quoteVolume24h)}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="mono text-sm font-semibold">{fmtTick(r.price)}</div>
          <div className={`mono text-2xs ${up ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(r.change24h)}</div>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-1.5 px-3 pt-3">
        {TFS.map((tf) => (
          <TFCell
            key={tf} tf={tf} c={r.direction[tf]} stacked
            open={open === tf}
            onToggle={() => setOpen(open === tf ? null : tf)}
          />
        ))}
      </div>

      {open && r.direction[open] && (
        <div className="px-3 pt-2">
          <Detail c={r.direction[open]!} />
        </div>
      )}

      <div className="mt-3 border-t border-line-soft bg-panel/50 px-3 py-2.5">
        <FlowBlock flow={r.flow} />
      </div>
    </article>
  );
}

// ------------------------------------------------------------
// Desktop: một hàng bảng cho mỗi mã
// ------------------------------------------------------------

export function BoardRow({ r }: { r: LiveRow }) {
  const [open, setOpen] = useState<TF | null>(null);

  return (
    <>
      <tr className="align-top">
        <td>
          <div className="mono font-semibold text-sky-300">{r.symbol}</div>
          <div className="mono text-2xs text-muted">{fmtTick(r.price)}</div>
        </td>
        <td className={`mono text-right ${r.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(r.change24h)}</td>
        <td className="mono text-right text-2xs text-muted">{fmtUsd(r.quoteVolume24h)}</td>
        {/*
          Chặn bề rộng: bảng chỉ có 7 cột nên trên màn 1440px cột này tự giãn ra
          hơn 600px, và một thanh Buy/Sell dài 600px không dễ đọc hơn thanh 300px
          — nó chỉ đẩy các cột khung thời gian ra xa khỏi tên mã.
        */}
        <td className="w-[340px] min-w-[220px]">
          <div className="max-w-[320px]">
            <FlowBlock flow={r.flow} />
          </div>
        </td>
        {TFS.map((tf) => (
          <td key={tf} className="w-[86px]">
            <TFCell
              tf={tf} c={r.direction[tf]}
              open={open === tf}
              onToggle={() => setOpen(open === tf ? null : tf)}
            />
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
