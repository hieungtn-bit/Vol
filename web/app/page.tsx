'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardRow, SymbolCard, type LiveRow } from '@/components/LiveBoard';
import { apiPath } from '@/config/site';
import { ALWAYS_INCLUDE } from '@/config/universe';
import { ictString } from '@/lib/format';
import type { TF } from '@/lib/types';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];
const REFRESH_MS = 60_000;

/** Nút lọc dạng pill — cao 44px, bấm bằng ngón cái được, và tự nói trạng thái. */
function Pill({
  on, onClick, children, tone = 'sky',
}: {
  on: boolean; onClick: () => void; children: React.ReactNode; tone?: 'sky' | 'emerald' | 'amber';
}) {
  const active = {
    sky: 'border-sky-400/60 bg-sky-400/15 text-sky-200',
    emerald: 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200',
    amber: 'border-amber-300/60 bg-amber-300/15 text-amber-200',
  }[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`tap-sm shrink-0 rounded-full border px-3 text-2xs font-semibold transition active:brightness-125 ${
        on ? active : 'border-line bg-panel2 text-muted'
      }`}
    >
      {children}
    </button>
  );
}

export default function LivePage() {
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [symbols] = useState<string[]>(ALWAYS_INCLUDE);
  const [extra, setExtra] = useState('');
  const [auto, setAuto] = useState(true);          // bản điện thì mặc định phải tự chạy
  const [goldOnly, setGoldOnly] = useState(false);
  // Mặc định BẬT: backtest đo được là bỏ các kèo trượt cửa giữ lại 7% số lệnh
  // nhưng nâng avgR 0.05 → 0.31 và hạ sụt giảm tối đa từ 116.9R xuống 6.3R.
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

  const longShare = tally.total > 0 ? (tally.long / tally.total) * 100 : 50;

  const emptyText = busy
    ? 'Đang quét…'
    : goldOnly
      ? 'Không có tín hiệu vàng nào lúc này — và đó là kết quả bình thường, nó vốn phải hiếm.'
      : tradeableOnly
        ? 'Không kèo nào qua cửa lúc này. Tắt "Qua cửa" để xem thiên hướng của mọi mã — nhưng đó là để theo dõi, không phải để vào tiền.'
        : 'Chưa có dữ liệu.';

  return (
    <div className="min-h-screen">
      {/*
        Thanh trên DÍNH. Trên điện thoại người ta cuộn liên tục, và hai thứ phải
        luôn nhìn thấy là: thị trường đang nghiêng bên nào, và dữ liệu còn mới
        không. Nếu phải cuộn ngược lên đầu mới biết thì coi như không có.
      */}
      <header className="safe-t sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="safe-x mx-auto max-w-[1400px] py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight">Bản điện · Long/Short</h1>
              <p className="mono text-[10px] leading-tight text-muted">{clock ?? '—'}</p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="tap-sm shrink-0 rounded-full border border-sky-500/50 bg-sky-500/15 px-3.5 text-2xs font-semibold text-sky-200 active:brightness-125 disabled:opacity-50"
            >
              {busy ? 'Đang quét…' : 'Quét lại'}
            </button>
          </div>

          {/* Tỷ lệ hai phe: một thanh nhìn phát hiểu, số nằm ngay trên nó. */}
          {tally.total > 0 && (
            <div className="mt-2">
              <div
                className="relative h-5 overflow-hidden rounded-md bg-red-500/25"
                role="img"
                aria-label={`${tally.long} kèo LONG trên ${tally.total}, ${tally.short} kèo SHORT`}
              >
                <div className="h-full bg-emerald-500/40" style={{ width: `${longShare}%` }} />
                <div className="absolute inset-0 flex items-center justify-between px-2">
                  <span className="mono text-[10px] font-semibold text-emerald-200">{tally.long} LONG</span>
                  <span className="mono text-[10px] font-semibold text-red-200">SHORT {tally.short}</span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                <span className={tally.ok > 0 ? 'font-semibold text-emerald-300' : ''}>
                  {tally.ok} qua cửa
                </span>
                <span aria-hidden>·</span>
                <span className={tally.gold > 0 ? 'font-semibold text-amber-300' : ''}>
                  ★ {tally.gold} vàng
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${busy ? 'bg-amber-400' : auto ? 'bg-emerald-400' : 'bg-slate-500'}`}
                    aria-hidden
                  />
                  {auto ? `${left}s` : 'tự chạy tắt'}
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="safe-x safe-b mx-auto max-w-[1400px] pt-3">
        {/* Bộ lọc: pill cuộn ngang được, không bao giờ làm vỡ hàng trên máy hẹp. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Pill tone="emerald" on={tradeableOnly} onClick={() => setTradeableOnly((v) => !v)}>
            {tradeableOnly ? '✓ ' : ''}Qua cửa
          </Pill>
          <Pill tone="amber" on={goldOnly} onClick={() => setGoldOnly((v) => !v)}>
            ★ Vàng
          </Pill>
          <Pill tone="sky" on={auto} onClick={() => setAuto((v) => !v)}>
            Tự chạy 60s
          </Pill>
          <input
            value={extra}
            placeholder="+ symbol, phẩy"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setExtra(e.target.value)}
            className="tap-sm mono min-w-0 flex-1 basis-40 rounded-full border border-line bg-panel2 px-3 text-2xs text-white placeholder:text-muted/70 board:max-w-48"
          />
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-red-600/40 bg-red-600/10 px-3 py-2 text-2xs leading-snug text-red-300">
            ⚠ {err}
          </div>
        )}

        {degraded.length > 0 && (
          <details className="mb-3 rounded-lg border border-slate-600/40 bg-slate-600/10">
            <summary className="tap-sm flex items-center justify-between px-3 text-2xs text-slate-300">
              <span><b>{degraded.length} nguồn dữ liệu thiếu</b> — ghi rõ, không bịa</span>
              <span aria-hidden className="text-sm">›</span>
            </summary>
            <ul className="space-y-1 border-t border-slate-600/40 px-3 py-2 text-2xs leading-snug text-slate-400">
              {degraded.slice(0, 6).map((d, i) => <li key={i}>– {d}</li>)}
            </ul>
          </details>
        )}

        {/* ---------- Mobile: danh sách thẻ ---------- */}
        <div className="space-y-3 board:hidden">
          {shown.length === 0 ? (
            <p className="rounded-xl border border-line bg-panel px-4 py-8 text-center text-2xs leading-relaxed text-muted">
              {emptyText}
            </p>
          ) : (
            shown.map((r) => <SymbolCard key={r.symbol} r={r} />)
          )}
        </div>

        {/* ---------- Desktop: bảng dense ---------- */}
        <div className="hidden board:block">
          <div className="scroll-x rounded-xl border border-line bg-panel">
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
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-2xs text-muted">{emptyText}</td></tr>
                )}
                {shown.map((r) => <BoardRow key={r.symbol} r={r} />)}
              </tbody>
            </table>
          </div>
        </div>

        {/*
          Phần giải thích dài xuống CUỐI và gấp lại.
          Bản trước đặt nguyên một khối chữ dài ở đầu trang; trên điện thoại nó
          đẩy toàn bộ dữ liệu — thứ người ta mở trang để xem — xuống dưới màn hình.
          Nội dung vẫn còn nguyên, chỉ là không chặn đường nữa.
        */}
        <details className="mt-4 rounded-xl border border-amber-600/40 bg-amber-600/10">
          <summary className="tap flex items-center justify-between gap-2 px-3 text-2xs font-semibold leading-snug text-amber-200">
            <span>Không phải lời khuyên đầu tư · Chốt TP1 · Không 10x gỡ lỗ</span>
            <span aria-hidden className="text-base leading-none">›</span>
          </summary>
          <div className="space-y-2 border-t border-amber-600/30 px-3 py-2.5 text-2xs leading-relaxed text-amber-100/90">
            <p>
              Bản điện này <b>luôn ra hướng</b>, không có WAIT — nên <b>cửa chất lượng</b> mới là
              thứ phải đọc, không phải hướng.
            </p>
            <p>
              <b className="text-emerald-300">Qua cửa</b> = mọi vế bằng chứng cùng hướng + hạng ≥ B
              + TP2 không quá xa + stop đủ rộng để phí không ăn quá 10% của 1R.
              Backtest 5.661 lệnh: lọc bằng đúng bốn điều này giữ <b>7%</b> số kèo mà nâng avgR
              0.05 → <b>0.31</b>, PF 1.11 → <b>2.16</b>, sụt giảm tối đa 116.9R → <b>6.3R</b>
              {' '}(ngoài mẫu 0.39 / PF 2.86). Đổi lại, kèo qua cửa rất hiếm.
            </p>
            <p>
              Kèo <b>trượt cửa vẫn có hướng</b>, nhưng là thiên hướng để theo dõi, không phải lệnh
              để vào tiền — mỗi kèo đều ghi rõ nó trượt vì điều kiện nào.
            </p>
            <p>
              Hạng: <b className="text-amber-300">★ vàng</b> = mọi vế đồng thuận và độ lệch ≥ 40 ·
              <b> A</b> lệch hẳn · <b>B</b> lệch vừa · <b>C</b> hai phía gần cân nhau.
              Rủi ro <b>0.5–1% tài khoản</b> mỗi lệnh.
            </p>
            <p className="text-amber-100/70">
              Bấm một ô khung giờ để mở Entry / SL / TP / bằng chứng. Taker perp và taker spot là
              hai chợ khác nhau nên luôn hiển thị tách rời — chỉ khi cả hai cùng nghiêng một phía
              mới ghi &ldquo;đồng thuận&rdquo;.
            </p>
          </div>
        </details>

        <p className="mt-3 text-center text-[10px] text-muted">
          {updated ? `Cập nhật ${updated}` : '—'} ·{' '}
          <a className="underline underline-offset-2 hover:text-sky-300" href="strict/">
            bảng kỷ luật (có WAIT)
          </a>
        </p>
      </main>
    </div>
  );
}
