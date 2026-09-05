'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SymbolDrawer from '@/components/SymbolDrawer';
import { BiasBadge } from '@/components/ui';
import { fmtPct, fmtPrice, fmtUsd, ictString } from '@/lib/format';
import { ALWAYS_INCLUDE, DEFAULT_MIN_QUOTE_VOL } from '@/config/universe';
import { apiPath } from '@/config/site';
import type { ScanSnapshot, SymbolScan, TF } from '@/lib/types';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];

type UniverseRow = { symbol: string; quoteVolume: number; pinned: boolean };

export default function Page() {
  const [minVol, setMinVol] = useState(DEFAULT_MIN_QUOTE_VOL);
  const [limit, setLimit] = useState(12);
  const [auto, setAuto] = useState(false);
  const [extra, setExtra] = useState('');
  const [universe, setUniverse] = useState<UniverseRow[]>([]);
  const [snap, setSnap] = useState<ScanSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Đồng hồ chỉ chạy ở client. Nếu render sẵn giờ trên server thì HTML server và
  // HTML client lệch nhau một nhịp → hydration mismatch.
  const [clock, setClock] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setClock(ictString());
    const t = setInterval(() => setClock(ictString()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadUniverse = useCallback(async () => {
    try {
      const r = await fetch(apiPath('universe', { minVol: String(minVol), extra }));
      const j = await r.json();
      if (j.ok) setUniverse(j.symbols);
      else setErr(j.error ?? 'không lấy được universe');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [minVol, extra]);

  useEffect(() => { void loadUniverse(); }, [loadUniverse]);

  const targets = useMemo(() => {
    const extras = extra.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const list = universe.length ? universe.map((u) => u.symbol) : ALWAYS_INCLUDE;
    return [...new Set([...ALWAYS_INCLUDE, ...extras, ...list])].slice(0, limit);
  }, [universe, extra, limit]);

  const scan = useCallback(async () => {
    if (targets.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(apiPath('scan', { symbols: targets.join(',') }));
      const j = await r.json();
      if (j.ok) setSnap(j as ScanSnapshot);
      else setErr(j.error ?? 'scan lỗi');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [targets]);

  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (auto) {
      void scan();
      timer.current = setInterval(() => { void scan(); }, 60_000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, scan]);

  const rows = snap?.symbols ?? [];
  const active = open ? rows.find((r) => r.symbol === open) ?? null : null;

  return (
    <main className="mx-auto max-w-[1400px] p-2 sm:p-4">
      {/* Banner cảnh báo — luôn hiện, không đóng được */}
      <div className="mb-3 rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-2xs leading-snug text-amber-200">
        <b>Không phải lời khuyên đầu tư. Chốt TP1. Không 10x gỡ lỗ.</b>{' '}
        WAIT là khuyến nghị hợp lệ và thường đúng hơn ép Long/Short. Rủi ro gợi ý 0.5–1% tài khoản mỗi lệnh.
        Isolated đòn bẩy cao + SL rộng = cháy, hệ sẽ cảnh báo đỏ khi gặp.
      </div>

      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Market Scan · Multi-TF</h1>
          <p className="text-2xs text-muted">
            Price Action + Volume Profile + OI + Funding. Mỗi khung 15m / 1h / 4h / 1D quyết định độc lập.
          </p>
          <a href="live/" className="text-2xs text-sky-300 underline hover:brightness-125">
            → Bản điện luôn ra hướng (Long/Short, không WAIT) + tỷ lệ Buy/Sell
          </a>
        </div>
        <div className="mono text-xs text-muted">{clock ?? '—'}</div>
      </header>

      {/* Hàng filter */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-panel p-2">
        <label className="text-2xs text-muted">
          Min vol 24h (USD)
          <input
            type="number" value={minVol} step={1_000_000} min={0}
            onChange={(e) => setMinVol(Number(e.target.value))}
            className="mono mt-0.5 block w-36 rounded border border-line bg-panel2 px-2 py-1 text-xs text-white"
          />
        </label>
        <label className="text-2xs text-muted">
          Số symbol
          <input
            type="number" value={limit} min={1} max={40}
            onChange={(e) => setLimit(Math.max(1, Math.min(40, Number(e.target.value))))}
            className="mono mt-0.5 block w-20 rounded border border-line bg-panel2 px-2 py-1 text-xs text-white"
          />
        </label>
        <label className="text-2xs text-muted">
          Thêm symbol (phẩy)
          <input
            value={extra} placeholder="SOLUSDT,LINKUSDT"
            onChange={(e) => setExtra(e.target.value)}
            className="mono mt-0.5 block w-48 rounded border border-line bg-panel2 px-2 py-1 text-xs text-white"
          />
        </label>
        <button
          onClick={() => void scan()} disabled={busy}
          className="rounded border border-sky-600/50 bg-sky-600/20 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:brightness-125 disabled:opacity-50"
        >
          {busy ? 'Đang quét…' : 'Quét ngay'}
        </button>
        <label className="flex items-center gap-1.5 text-2xs text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto 60s
        </label>
        <div className="ml-auto text-2xs text-muted">
          {snap ? `Cập nhật ${snap.ictTime} · ${snap.symbols.length} symbol` : `${targets.length} symbol sẵn sàng`}
        </div>
      </div>

      {err && (
        <div className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-2xs text-red-300">⚠ {err}</div>
      )}

      {snap && snap.degraded.length > 0 && (
        <div className="mb-3 rounded border border-slate-600/40 bg-slate-600/10 px-3 py-2 text-2xs text-slate-300">
          <b>Dữ liệu thiếu (ghi rõ, không bịa):</b>
          <ul className="mt-1 space-y-0.5">
            {snap.degraded.slice(0, 6).map((d, i) => <li key={i}>– {d}</li>)}
          </ul>
        </div>
      )}

      {/* Bảng chính */}
      <div className="scroll-x rounded-lg border border-line bg-panel">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="text-right">Price</th>
              <th className="text-right">24h%</th>
              <th className="text-right">Vol 24h</th>
              <th className="text-right">Range pos</th>
              {TFS.map((tf) => <th key={tf} className="text-center">{tf}</th>)}
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-2xs text-muted">
                Bấm <b>Quét ngay</b> để chạy. Mặc định watchlist gồm {ALWAYS_INCLUDE.join(', ')}.
              </td></tr>
            )}
            {rows.map((s) => <Row key={s.symbol} s={s} onOpen={() => setOpen(s.symbol)} />)}
          </tbody>
        </table>
      </div>

      {snap && (
        <p className="mt-2 text-2xs text-muted">
          Nguồn: spot <span className="mono">{new URL(snap.sources.spot).host}</span> ·
          perp <span className="mono">{snap.sources.perp.includes('CHẾT') ? 'N/A' : new URL(snap.sources.perp).host}</span> ·
          okx <span className="mono">{new URL(snap.sources.okx).host}</span>.
          Snapshot mỗi lần scan được lưu JSON để so lại.
        </p>
      )}

      {active && <SymbolDrawer scan={active} onClose={() => setOpen(null)} />}
    </main>
  );
}

function Row({ s, onOpen }: { s: SymbolScan; onOpen: () => void }) {
  const bs = s.tfs['15m'].vp.binSize;
  const anyWarn = TFS.some((tf) => s.tfs[tf].warnings.length > 0);
  const counter = TFS.some((tf) => s.tfs[tf].counterTrend);

  return (
    <tr>
      <td>
        <button onClick={onOpen} className="mono font-semibold text-sky-300 hover:underline">{s.symbol}</button>
      </td>
      <td className="mono text-right">{fmtPrice(s.price, bs)}</td>
      <td className={`mono text-right ${s.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(s.change24h)}</td>
      <td className="mono text-right text-muted">{fmtUsd(s.quoteVolume24h)}</td>
      <td className="mono text-right">
        <span className={s.rangePos > 80 ? 'text-red-300' : s.rangePos < 20 ? 'text-emerald-300' : ''}>
          {s.rangePos.toFixed(0)}%
        </span>
      </td>
      {TFS.map((tf) => (
        <td key={tf} className="w-16"><BiasBadge r={s.tfs[tf]} onClick={onOpen} /></td>
      ))}
      <td className="text-2xs text-muted">
        {anyWarn && <span className="mr-2 text-red-400">⚠ cảnh báo</span>}
        {counter && <span className="mr-2 text-amber-400">counter-trend</span>}
        {s.composite.dualRead ? s.composite.dualRead.slice(0, 60) + '…' : ''}
      </td>
    </tr>
  );
}
