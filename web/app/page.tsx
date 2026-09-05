'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardRow, type LiveRow } from '@/components/LiveBoard';
import { apiPath } from '@/config/site';
import { ALWAYS_INCLUDE } from '@/config/universe';
import { ictString } from '@/lib/format';
import type { TF } from '@/lib/types';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];
const REFRESH_MS = 60_000;

export default function LivePage() {
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [symbols, setSymbols] = useState<string[]>(ALWAYS_INCLUDE);
  const [extra, setExtra] = useState('');
  const [auto, setAuto] = useState(true);          // bản điện thì mặc định phải tự chạy
  const [goldOnly, setGoldOnly] = useState(false);
  // Mặc định BẬT: backtest đo được là bỏ các kèo trượt cửa giữ lại 22% số lệnh
  // nhưng nâng avgR 0.05 → 0.18 và hạ sụt giảm tối đa từ 105.9R xuống 8.7R.
  const [tradeableOnly, setTradeableOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string[]>([]);
  const [updated, setUpdated] = useState<string | null>(null);
  const [left, setLeft] = useState(REFRESH_MS / 1000);
  const [clock, setClock] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const targets = useMemo(() => {
    const ex = extra.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    return [...new Set([...symbols, ...ex])].slice(0, 24);
  }, [symbols, extra]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(apiPath('scan', { symbols: targets.join(',') }));
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'scan lỗi');
      setRows(j.symbols.map((s: any) => ({
        symbol: s.symbol, price: s.price, change24h: s.change24h,
        quoteVolume24h: s.quoteVolume24h, direction: s.direction, flow: s.flow,
      })));
      setDegraded(j.degraded ?? []);
      setUpdated(j.ictTime ?? null);
      setLeft(REFRESH_MS / 1000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [targets]);

  useEffect(() => {
    setClock(ictString());
    const t = setInterval(() => {
      setClock(ictString());
      setLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (auto) timer.current = setInterval(() => { void load(); }, REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, load]);

  // Đếm nhanh hai phe để nhìn phát biết thị trường đang nghiêng đâu
  const tally = useMemo(() => {
    let long = 0, short = 0, gold = 0, ok = 0;
    for (const r of rows) for (const tf of TFS) {
      const c = r.direction?.[tf];
      if (!c) continue;
      if (c.side === 'LONG') long++; else short++;
      if (c.golden) gold++;
      if (c.tradeable) ok++;
    }
    return { long, short, gold, ok, total: long + short };
  }, [rows]);

  const shown = useMemo(() => {
    let out = rows;
    if (tradeableOnly) out = out.filter((r) => TFS.some((tf) => r.direction?.[tf]?.tradeable));
    if (goldOnly) out = out.filter((r) => TFS.some((tf) => r.direction?.[tf]?.golden));
    return out;
  }, [rows, goldOnly, tradeableOnly]);

  return (
    <main className="mx-auto max-w-[1400px] p-2 sm:p-4">
      <div className="mb-3 rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-2xs leading-snug text-amber-200">
        <b>Không phải lời khuyên đầu tư. Chốt TP1. Không 10x gỡ lỗ.</b>{' '}
        Bản điện này <b>luôn ra hướng</b>, không có WAIT — nên <b>cửa chất lượng</b> mới là thứ phải đọc.
        <b className="text-emerald-300"> Qua cửa</b> = mọi vế cùng hướng + hạng ≥ B + TP2 không quá xa;
        backtest 5.521 lệnh cho thấy lọc bằng đúng ba điều này giữ 22% số kèo mà nâng
        avgR 0.05 → 0.18 và hạ sụt giảm tối đa 105.9R → 8.7R. Kèo <b>trượt cửa vẫn có hướng</b>,
        nhưng là thiên hướng để theo dõi, không phải lệnh để vào tiền.
        <b className="text-amber-300"> ★ vàng</b> = mọi vế đồng thuận và độ lệch ≥ 40 ·
        <b> A</b> = lệch hẳn · <b>B</b> = lệch vừa · <b>C</b> = hai phía gần cân nhau.
        Rủi ro 0.5–1% tài khoản mỗi lệnh.
      </div>

      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Bản điện · Long/Short liên tục</h1>
          <p className="text-2xs text-muted">
            HH/HL/LH/LL · Value Area · Price Action · Volume · Open Interest · Funding (ai trả ai) · Taker Buy/Sell
          </p>
        </div>
        <div className="text-right">
          <div className="mono text-xs text-muted">{clock ?? '—'}</div>
          {tally.total > 0 && (
            <div className="mono text-2xs">
              <span className="text-emerald-400">{tally.long} LONG</span>
              {' / '}
              <span className="text-red-400">{tally.short} SHORT</span>
              {' · '}
              <span className={tally.ok > 0 ? 'text-emerald-300' : 'text-muted'}>
                {tally.ok} qua cửa
              </span>
              {' · '}
              <span className={tally.gold > 0 ? 'text-amber-300' : 'text-muted'}>
                ★ {tally.gold} vàng
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel p-2">
        <label className="text-2xs text-muted">
          Thêm symbol (phẩy)
          <input
            value={extra} placeholder="SOLUSDT,LINKUSDT"
            onChange={(e) => setExtra(e.target.value)}
            className="mono mt-0.5 block w-52 rounded border border-line bg-panel2 px-2 py-1 text-xs text-white"
          />
        </label>
        <button
          onClick={() => void load()} disabled={busy}
          className="rounded border border-sky-600/50 bg-sky-600/20 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:brightness-125 disabled:opacity-50"
        >
          {busy ? 'Đang quét…' : 'Quét lại ngay'}
        </button>
        <label className="flex items-center gap-1.5 text-2xs text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Tự chạy 60s
        </label>
        <label className="flex items-center gap-1.5 text-2xs text-emerald-300">
          <input type="checkbox" checked={tradeableOnly} onChange={(e) => setTradeableOnly(e.target.checked)} />
          Chỉ kèo qua cửa
        </label>
        <label className="flex items-center gap-1.5 text-2xs text-amber-300">
          <input type="checkbox" checked={goldOnly} onChange={(e) => setGoldOnly(e.target.checked)} />
          ★ Chỉ tín hiệu vàng
        </label>
        {auto && (
          <span className="mono text-2xs text-muted">
            làm mới sau {left}s
            <span className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full ${busy ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          </span>
        )}
        <div className="ml-auto text-2xs text-muted">
          {updated ? `Cập nhật ${updated}` : '—'} · <a className="underline hover:text-sky-300" href="strict/">bảng kỷ luật (có WAIT)</a>
        </div>
      </div>

      {err && <div className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-2xs text-red-300">⚠ {err}</div>}

      {degraded.length > 0 && (
        <div className="mb-3 rounded border border-slate-600/40 bg-slate-600/10 px-3 py-2 text-2xs text-slate-300">
          <b>Dữ liệu thiếu (ghi rõ, không bịa):</b>
          <ul className="mt-1 space-y-0.5">{degraded.slice(0, 5).map((d, i) => <li key={i}>– {d}</li>)}</ul>
        </div>
      )}

      <div className="scroll-x rounded-lg border border-line bg-panel">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="text-right">24h%</th>
              <th className="text-right">Vol</th>
              <th>Buy / Sell · ai trả ai</th>
              {TFS.map((tf) => <th key={tf} className="text-center">{tf}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-2xs text-muted">
                {busy ? 'Đang quét…'
                  : goldOnly ? 'Không có tín hiệu vàng nào lúc này — và đó là kết quả bình thường, nó vốn phải hiếm.'
                  : tradeableOnly ? 'Không kèo nào qua cửa lúc này. Bỏ tick "Chỉ kèo qua cửa" để xem thiên hướng của mọi mã — nhưng đó là để theo dõi, không phải để vào tiền.'
                  : 'Chưa có dữ liệu.'}
              </td></tr>
            )}
            {shown.map((r) => <BoardRow key={r.symbol} r={r} />)}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-2xs leading-snug text-muted">
        Bấm vào badge của một khung để mở Entry / SL / TP / bằng chứng chấm điểm của khung đó.
        Taker perp và taker spot là hai chợ khác nhau nên luôn hiển thị tách rời — chỉ khi cả hai
        cùng nghiêng một phía mới ghi &ldquo;đồng thuận&rdquo;.
      </p>
    </main>
  );
}
