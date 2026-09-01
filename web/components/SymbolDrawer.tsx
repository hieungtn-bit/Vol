'use client';

import { useMemo, useState } from 'react';
import { BiasBadge, Field, SizePill, STAGE_VI, VPMini, Warn } from './ui';
import { fmtPct, fmtPrice, fmtUsd } from '@/lib/format';
import type { Recommendation, SymbolScan, TF } from '@/lib/types';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="rounded border border-line bg-panel2 px-2 py-1 text-2xs hover:brightness-125"
    >
      {done ? '✓ đã copy' : 'Copy plan'}
    </button>
  );
}

/** Checklist trigger: những điều PHẢI thấy trước khi bấm lệnh. */
function Checklist({ r }: { r: Recommendation }) {
  const bs = r.vp.binSize;
  const items = useMemo(() => {
    if (r.bias === 'WAIT') {
      return [
        `Giá rời lõi VA ${fmtPrice(r.vp.vaLow, bs)}–${fmtPrice(r.vp.vaHigh, bs)} và về một mép`,
        `Có nến ${r.tf} ĐÓNG xác nhận ở mép đó`,
        'Score ≥ 7 (hệ tự bật badge Long/Short)',
        'Không vào market ở giữa VA, kể cả khi "cảm thấy" đúng',
      ];
    }
    return [
      `Giá về vùng entry ${fmtPrice(r.entry?.[0], bs)}–${fmtPrice(r.entry?.[1], bs)} (đặt limit, không đuổi)`,
      r.trigger,
      `SL đã đặt sẵn ở ${fmtPrice(r.sl, bs)} TRƯỚC khi vào`,
      `TP1 ${fmtPrice(r.tp1, bs)} chốt 50% — không dời, không "để chạy thêm"`,
      r.counterTrend ? 'Counter-trend: size Small, chốt TP1 bắt buộc' : 'Rủi ro 0.5–1% tài khoản cho lệnh này',
    ];
  }, [r, bs]);

  return (
    <ul className="mt-2 space-y-1">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-2xs text-slate-300">
          <span className="text-muted">☐</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function TFCard({ r }: { r: Recommendation }) {
  const bs = r.vp.binSize;
  const P = (x: number | null | undefined) => fmtPrice(x, bs);
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="mono text-sm font-semibold">{r.tf}</span>
          <span className="text-2xs text-muted">{STAGE_VI[r.stage]}</span>
        </div>
        <div className="w-16"><BiasBadge r={r} /></div>
      </div>

      <VPMini r={r} />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted">
        <span>POC <span className="mono text-fuchsia-300">{P(r.vp.poc)}</span></span>
        <span>VA <span className="mono text-sky-300">{P(r.vp.vaLow)}–{P(r.vp.vaHigh)}</span></span>
        <span>Giá <span className="mono text-white">{P(r.vp.last)}</span></span>
        <span>Range pos <span className="mono">{r.rangePos.toFixed(0)}%</span></span>
      </div>

      <div className="mt-2">
        <Field label="Entry" value={r.entry ? `${P(r.entry[0])} – ${P(r.entry[1])}` : '—'} />
        <Field label="Trigger" value={<span className="whitespace-normal text-right">{r.trigger}</span>} mono={false} />
        <Field label="SL" value={P(r.sl)} />
        <Field label="TP1 (50%)" value={`${P(r.tp1)}${r.rr1 != null ? `  ·  RR ${r.rr1.toFixed(2)}` : ''}`} />
        <Field label="TP2 (30%)" value={`${P(r.tp2)}${r.rr2 != null ? `  ·  RR ${r.rr2.toFixed(2)}` : ''}`} />
        <Field label="Runner" value={<span className="whitespace-normal text-right">{r.runner ?? 'không mở'}</span>} mono={false} />
        <Field label="Hủy" value={<span className="whitespace-normal text-right">{r.invalidation}</span>} mono={false} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SizePill size={r.size} counter={r.counterTrend} />
        <span className="text-2xs text-muted">Confidence {r.confidence}/10</span>
      </div>

      {r.warnings.length > 0 && (
        <div className="mt-2 space-y-1">{r.warnings.map((w, i) => <Warn key={i}>{w}</Warn>)}</div>
      )}

      <div className="mt-2">
        <div className="text-2xs font-semibold uppercase tracking-wide text-muted">Lý do</div>
        <ul className="mt-1 space-y-0.5">
          {r.reasons.map((x, i) => (
            <li key={i} className="text-2xs leading-snug text-slate-300">– {x}</li>
          ))}
        </ul>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-2xs text-muted">Bảng điểm hợp lưu ({r.confluence.score.toFixed(1)}/10)</summary>
        <ul className="mt-1 space-y-0.5">
          {r.confluence.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 text-2xs">
              <span className="text-slate-400">{l.label}</span>
              <span className={`mono ${l.points >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {l.points >= 0 ? '+' : ''}{l.points}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-2">
        <div className="text-2xs font-semibold uppercase tracking-wide text-muted">Checklist trước khi bấm</div>
        <Checklist r={r} />
      </div>

      <div className="mt-2 flex justify-end"><CopyBtn text={r.planText} /></div>
    </div>
  );
}

export default function SymbolDrawer({ scan, onClose }: { scan: SymbolScan; onClose: () => void }) {
  const bs = scan.tfs['15m'].vp.binSize;
  const d = scan.derivatives;
  const allPlans = TFS.map((tf) => scan.tfs[tf].planText).join('\n\n');

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-line bg-bg p-3 sm:p-4">
        <div className="sticky top-0 -mx-3 mb-3 flex items-center justify-between gap-2 border-b border-line bg-bg px-3 py-2 sm:-mx-4 sm:px-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="mono text-lg font-semibold">{scan.symbol}</h2>
              <span className="mono text-sm">{fmtPrice(scan.price, bs)}</span>
              <span className={`mono text-xs ${scan.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtPct(scan.change24h)}
              </span>
            </div>
            <div className="text-2xs text-muted">Vol 24h {fmtUsd(scan.quoteVolume24h)} · Range pos {scan.rangePos.toFixed(0)}%</div>
          </div>
          <div className="flex items-center gap-2">
            <CopyBtn text={allPlans} />
            <button onClick={onClose} className="rounded border border-line bg-panel2 px-2 py-1 text-2xs hover:brightness-125">Đóng</button>
          </div>
        </div>

        {/* Phái sinh + composite */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted">Funding · OI · Delta</div>
            <Field label="Funding" value={
              d.funding.quality === 'REAL'
                ? `${(d.funding.rate! * 100).toFixed(4)}%/8h · ${d.funding.venue}`
                : 'N/A'} />
            <Field label="Trạng thái FR" value={<span className="whitespace-normal text-right">{d.funding.note}</span>} mono={false} />
            <Field label="OI" value={d.oi.open != null ? `${fmtUsd(d.oi.open)} ${d.oi.unit ?? ''}` : 'N/A'} />
            <Field label="OI Δ1h / Δ24h" value={`${fmtPct(d.oi.chg1h)} / ${fmtPct(d.oi.chg24h)}`} />
            <Field label="Đọc OI" value={<span className="whitespace-normal text-right">{d.oi.read === 'na' ? 'N/A — không dùng làm lý do' : d.oi.note}</span>} mono={false} />
            <Field label="Taker perp" value={d.perpTaker.quality === 'UNAVAILABLE' ? 'N/A' : 'REAL'} />
            <Field label="Delta spot" value={`${scan.spotTakerDelta.quality} · CVD ${scan.spotTakerDelta.cvd != null ? fmtUsd(scan.spotTakerDelta.cvd) : 'N/A'}`} />
            <div className="mt-1 text-2xs text-muted">{scan.spotTakerDelta.note}</div>
          </div>

          <div className="rounded-lg border border-line bg-panel p-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted">Composite Volume Profile</div>
            <Field label="POC session (00:00 ICT)" value={fmtPrice(scan.composite.sessionPoc, bs)} />
            <Field label="POC 24h" value={fmtPrice(scan.composite.h24Poc, bs)} />
            <Field label="POC 3D" value={fmtPrice(scan.composite.d3Poc, bs)} />
            {scan.composite.dualRead && (
              <p className="mt-2 text-2xs leading-snug text-slate-300">{scan.composite.dualRead}</p>
            )}
            {scan.errors.length > 0 && (
              <div className="mt-2 space-y-1">{scan.errors.map((e, i) => <Warn key={i}>{e}</Warn>)}</div>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {TFS.map((tf) => <TFCard key={tf} r={scan.tfs[tf]} />)}
        </div>

        <p className="mt-4 text-2xs leading-snug text-muted">
          Không phải lời khuyên đầu tư. Chốt TP1. Không 10x gỡ lỗ. Mọi số ở đây là kết quả tính máy trên
          dữ liệu public, không phải dự đoán.
        </p>
      </aside>
    </div>
  );
}
