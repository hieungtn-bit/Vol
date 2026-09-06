'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiPath } from '@/config/site';
import { ALWAYS_INCLUDE } from '@/config/universe';
import { fmtTick, ictString } from '@/lib/format';
import type { TFPlan, TFRead } from '@/lib/tfRead';
import type { TF } from '@/lib/types';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];
const REFRESH_MS = 60_000;

type Row = { symbol: string; price: number; read: TFRead };

const STATUS = {
  du_dieu_kien: { label: 'ĐỦ ĐIỀU KIỆN', cls: 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200', rank: 0 },
  cho_xac_nhan: { label: 'CHỜ XÁC NHẬN', cls: 'border-amber-400/60 bg-amber-400/15 text-amber-200', rank: 1 },
  dang_theo_doi: { label: 'ĐANG THEO DÕI', cls: 'border-slate-500/50 bg-slate-500/10 text-slate-300', rank: 2 },
  thieu_du_lieu: { label: 'THIẾU DỮ LIỆU', cls: 'border-red-500/50 bg-red-500/10 text-red-300', rank: 3 },
} as const;

const SIDE = { mua: 'MỞ MUA', ban: 'MỞ BÁN', dung_ngoai: 'đứng ngoài' } as const;
const SIDE_CLS = { mua: 'text-emerald-300', ban: 'text-red-300', dung_ngoai: 'text-slate-400' } as const;

const L = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-2 border-b border-line/50 py-0.5">
    <span className="text-muted">{k}</span><span className="mono text-right text-xs">{v}</span>
  </div>
);

function Levels({ p, real }: { p: TFPlan; real: boolean }) {
  return (
    <div className={`mt-2 rounded-lg border p-2 ${real ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-line bg-panel2/50'}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
          {real ? 'Kế hoạch' : 'Mức dự kiến — chưa đủ điều kiện, không phải lệnh'}
        </span>
        <span className="mono text-[10px] text-muted">khổ {p.size === 'kho_du' ? 'đủ' : 'nửa'}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4">
        <L k="Vào" v={`${p.entry[0]} – ${p.entry[1]}`} />
        <L k="Cắt" v={<span className="text-red-300">{p.sl}</span>} />
        <L k="Chốt 1" v={<span className="text-emerald-300">{p.tp1}</span>} />
        <L k="Chốt 2" v={<span className="text-emerald-300">{p.tp2}</span>} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line/60 pt-1.5 text-2xs">
        <span className="text-muted">R:R <span className="mono text-slate-200">{p.rr1.toFixed(2)}</span> / <span className="mono text-slate-200">{p.rr2.toFixed(2)}</span></span>
        <span className="text-muted">phí <span className="mono text-slate-300">{p.feeR.toFixed(3)}R</span></span>
        <span className={`font-semibold ${p.rrNet > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
          R sau phí <span className="mono">{p.rrNet.toFixed(2)}</span>
        </span>
      </div>
      <p className="mt-1 text-2xs leading-snug text-slate-400"><b>Kích hoạt:</b> {p.trigger}</p>
    </div>
  );
}

function SetupCard({ r }: { r: Row }) {
  const s = STATUS[r.read.setup_status];
  const p = r.read.plan ?? r.read.prospect;
  return (
    <article className="rounded-xl border border-line bg-panel p-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className="mono text-sm font-semibold text-sky-300">{r.symbol}</span>
        <span className="mono rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold">{r.read.tf}</span>
        <span className={`mono text-xs font-bold ${SIDE_CLS[r.read.bias]}`}>{SIDE[r.read.bias]}</span>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.label}</span>
        <span className="mono ml-auto text-2xs text-muted">
          điểm <b className={r.read.score >= 7 ? 'text-emerald-300' : 'text-slate-200'}>{r.read.score.toFixed(1)}</b>/7
        </span>
      </header>

      <p className="mt-1.5 text-2xs leading-snug text-slate-300">{r.read.state_text}</p>
      <p className="mt-1 text-2xs text-muted">
        giá <span className="mono text-slate-200">{fmtTick(r.price)}</span> · lớp {r.read.layer} ·
        {' '}vùng <span className="mono">{r.read.val}–{r.read.vah}</span> ·
        {' '}điểm kiểm soát <span className="mono">{r.read.poc[0]}–{r.read.poc[1]}</span>
      </p>

      {p && <Levels p={p} real={r.read.plan != null} />}

      {r.read.missing_conditions.length > 0 && (
        <div className="mt-2 rounded-lg border border-line bg-panel2/60 p-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Còn thiếu</div>
          <ul className="mt-1 space-y-0.5 text-2xs leading-snug text-slate-400">
            {r.read.missing_conditions.map((m, i) => <li key={i}>– {m}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-1.5 text-2xs leading-snug text-sky-300/80">{r.read.watch}</p>
    </article>
  );
}

export default function SetupsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [clock, setClock] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ from: string; to: string; note: string; trades: Record<string, never>[] } | null>(null);
  const [showReplay, setShowReplay] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(apiPath('scan', { symbols: ALWAYS_INCLUDE.join(',') }));
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? 'scan lỗi');
      const out: Row[] = [];
      for (const s of j.symbols) {
        for (const tf of TFS) {
          const read: TFRead | null = s.reads?.[tf];
          if (read) out.push({ symbol: s.symbol, price: s.price, read });
        }
      }
      out.sort((a, b) => STATUS[a.read.setup_status].rank - STATUS[b.read.setup_status].rank
        || b.read.score - a.read.score);
      setRows(out);
      setUpdated(j.ictTime ?? null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); const t = setInterval(() => void load(), REFRESH_MS); return () => clearInterval(t); }, [load]);
  useEffect(() => { setClock(ictString()); const t = setInterval(() => setClock(ictString()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { fetch('replay.json').then((r) => r.json()).then(setReplay).catch(() => undefined); }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { du_dieu_kien: 0, cho_xac_nhan: 0, dang_theo_doi: 0, thieu_du_lieu: 0 };
    for (const r of rows) c[r.read.setup_status]++;
    return c;
  }, [rows]);

  return (
    <div className="min-h-screen">
      <header className="safe-t sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="safe-x mx-auto max-w-[1100px] py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-sm font-semibold">Setup đang hình thành</h1>
              <p className="mono text-[10px] text-muted">{clock ?? '—'} · sàn điểm 7 · bản xem thử</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={busy}
              className="tap-sm shrink-0 rounded-full border border-sky-500/50 bg-sky-500/15 px-3.5 text-2xs font-semibold text-sky-200 disabled:opacity-50">
              {busy ? 'Đang quét…' : 'Quét lại'}
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => (
              <span key={k} className={`rounded border px-2 py-0.5 text-[10px] font-bold ${STATUS[k].cls}`}>
                {STATUS[k].label} {counts[k] ?? 0}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="safe-x safe-b mx-auto max-w-[1100px] space-y-3 pt-3">
        {err && <div className="rounded-lg border border-red-600/40 bg-red-600/10 px-3 py-2 text-2xs text-red-300">⚠ {err}</div>}
        {rows.length === 0 && !busy && (
          <p className="rounded-xl border border-line bg-panel px-4 py-8 text-center text-2xs text-muted">Chưa có dữ liệu.</p>
        )}
        {rows.map((r) => <SetupCard key={`${r.symbol}-${r.read.tf}`} r={r} />)}

        {replay && (
          <section className="overflow-hidden rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/5">
            <button type="button" onClick={() => setShowReplay((v) => !v)}
              className="tap flex w-full items-center justify-between gap-2 px-3 text-left">
              <span>
                <span className="mono rounded bg-fuchsia-500/25 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-200">REPLAY</span>
                <span className="ml-2 text-2xs font-semibold text-fuchsia-100">
                  {replay.trades.length} lệnh lịch sử · {replay.from} → {replay.to}
                </span>
              </span>
              <span aria-hidden className="text-base leading-none text-fuchsia-200">{showReplay ? '⌄' : '›'}</span>
            </button>
            <p className="px-3 pb-2 text-2xs leading-snug text-fuchsia-200/80">{replay.note}</p>
            {showReplay && (
              <div className="scroll-x border-t border-fuchsia-500/30">
                <table className="tbl w-full text-xs">
                  <thead><tr>
                    <th>Thời gian</th><th>Mã</th><th>Khung</th><th>Hướng</th>
                    <th className="text-right">Điểm</th><th className="text-right">Vào</th>
                    <th className="text-right">Cắt</th><th className="text-right">Chốt 1</th>
                    <th>Thoát</th><th className="text-right">R sau phí</th>
                  </tr></thead>
                  <tbody>
                    {replay.trades.slice(0, 40).map((t: Record<string, never>, i: number) => {
                      const x = t as unknown as { signalTime: number; symbol: string; tf: string; side: 'mua' | 'ban'; score: number; entry: number; sl: number; tp1: number; exitReason: string; r: number };
                      return (
                        <tr key={i}>
                          <td className="mono text-2xs">{new Date(x.signalTime + 7 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')}</td>
                          <td className="mono text-sky-300">{x.symbol}</td>
                          <td className="mono">{x.tf}</td>
                          <td className={`font-bold ${x.side === 'mua' ? 'text-emerald-300' : 'text-red-300'}`}>{SIDE[x.side]}</td>
                          <td className="mono text-right">{x.score.toFixed(1)}</td>
                          <td className="mono text-right">{x.entry}</td>
                          <td className="mono text-right text-red-300">{x.sl}</td>
                          <td className="mono text-right text-emerald-300">{x.tp1}</td>
                          <td className="text-2xs">{x.exitReason}</td>
                          <td className={`mono text-right font-semibold ${x.r >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{x.r.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <p className="pb-2 text-center text-[10px] text-muted">
          {updated ? `Cập nhật ${updated}` : '—'} · sàn 7 giữ nguyên · chưa đổi production
        </p>
      </main>
    </div>
  );
}
