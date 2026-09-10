'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiPath } from '@/config/site';
import { ALWAYS_INCLUDE } from '@/config/universe';
import { ictString } from '@/lib/format';
import { money, planOrder, prettyQty, readRR, type OrderPlan } from '@/lib/sizing';
import type { TF } from '@/lib/types';

// ============================================================
// BẢNG ĐỂ VÀO TIỀN.
//
// Khác hai bảng kia ở mục đích, nên khác cả ở cái được giấu đi:
//
//   /        — mọi mã, mọi khung, luôn có hướng. Để ĐỌC thị trường.
//   /strict  — có WAIT, ngưỡng điểm. Để đối chiếu KỶ LUẬT.
//   /vao-tien — CHỈ kèo qua cửa, kèm khối lượng và tiền. Để ĐẶT LỆNH.
//
// Bảng này giấu tất cả những gì không đặt lệnh được. Một bảng để vào tiền mà
// hiện 28 dòng WAIT thì người dùng phải tự lọc bằng mắt, và lọc bằng mắt lúc
// đang cầm tiền là lúc dễ tự thuyết phục mình nhất.
//
// VÌ SAO CHỌN ĐÚNG CỬA NÀY: `tradeable` là cấu hình DUY NHẤT vừa dương vừa đủ
// mẫu để tin — đo lại bằng bộ mô phỏng đã sửa: n=384 lệnh, avgR 0.18, và ngoài
// mẫu avgR 0.31 / PF 2.14 trên n=192. Mọi cấu hình khác hoặc âm, hoặc chỉ có
// hai ba chục lệnh ngoài mẫu nên không nói được gì.
// ============================================================

const TFS: TF[] = ['15m', '1h', '4h', '1d'];
const REFRESH_MS = 60_000;

interface Call {
  side: 'LONG' | 'SHORT';
  conviction: string;
  golden: boolean;
  tradeable: boolean;
  net: number;
  entry: [number, number];
  sl: number; tp1: number; tp2: number;
  rr1: number | null; rr2: number | null;
  trigger: string; invalidation: string;
  warnings: string[];
}
interface Row { symbol: string; price: number; direction: Record<TF, Call | null> }
interface Setup { symbol: string; tf: TF; call: Call; plan: OrderPlan }

/** Ô nhập số — nhãn nằm trên, đủ to để bấm bằng ngón cái. */
function NumField({
  label, value, onChange, suffix, step = '1',
}: { label: string; value: number; onChange: (n: number) => void; suffix?: string; step?: string }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-2xs text-muted">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min="0"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tap mono w-full rounded-lg border border-line bg-panel2 px-3 pr-10 text-sm text-white"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-2xs text-muted">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

/** Một dòng "làm gì": nhãn trái, số phải, số dùng font mono để so cột được. */
function Line({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  const c = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-white';
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-2xs text-muted">{k}</span>
      <span className={`mono text-right text-xs ${c}`}>{v}</span>
    </div>
  );
}

function SetupCard({ s }: { s: Setup }) {
  const { call: c, plan: p } = s;
  const long = c.side === 'LONG';
  const px = (x: number) => x.toPrecision(6).replace(/\.?0+$/, '');
  const nguyHiem = p.vuotDonBay || p.khongDuVon;
  const rr = readRR(p.rewardR);

  return (
    <article className="rounded-xl border border-line bg-panel">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="mono text-sm font-semibold text-sky-300">{s.symbol}</span>
        <span className="rounded bg-panel2 px-1.5 py-0.5 text-2xs text-muted">{s.tf}</span>
        <span
          className={`rounded px-2 py-0.5 text-2xs font-bold ${
            long ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
          }`}
        >
          {c.side}
        </span>
        {c.golden && <span className="text-2xs text-amber-300">★ vàng</span>}
        <span className="ml-auto text-2xs text-muted">hạng {c.conviction}</span>
      </header>

      {/* Đặt lệnh gì — phần duy nhất cần khi tay đang ở bàn phím sàn. */}
      <div className="border-b border-line px-3 py-2">
        <p className="mb-1.5 text-2xs font-semibold text-muted">ĐẶT LỆNH</p>
        {/* Long là MUA để mở, short là BÁN để mở. Nhãn phải nói đúng việc sắp
            bấm — một bảng để vào tiền mà ghi "chờ mua" cho kèo short thì người
            đọc bấm nhầm chiều. */}
        <Line
          k={long ? 'Chờ MUA (limit dưới giá)' : 'Chờ BÁN (limit trên giá)'}
          v={px(p.entryPrice)}
        />
        <Line k="Khối lượng" v={`${prettyQty(p.qty)} ${s.symbol.replace('USDT', '')}`} />
        <Line k="Giá trị vị thế" v={`${p.notional.toFixed(0)} USDT`} />
        <Line k="Cắt lỗ" v={px(p.sl)} tone="bad" />
        <Line k={`Chốt 1 · ${prettyQty(p.qtyLeg)}`} v={px(p.tp1)} tone="good" />
        <Line k={`Chốt 2 · ${prettyQty(p.qtyLeg)}`} v={px(p.tp2)} tone="good" />
      </div>

      {/* Mất bao nhiêu, được bao nhiêu — bằng TIỀN, không bằng R. */}
      <div className="border-b border-line px-3 py-2">
        <p className="mb-1.5 text-2xs font-semibold text-muted">TIỀN (đã trừ phí)</p>
        <Line k="Sai → mất" v={`${money(p.outcomes.stopped)} USDT`} tone="bad" />
        <Line k="Chốt 1 rồi quay đầu" v={`${money(p.outcomes.tp1ThenSL)} USDT`} tone={p.outcomes.tp1ThenSL >= 0 ? 'good' : 'bad'} />
        <Line k="Chạm cả hai mốc" v={`${money(p.outcomes.bothTP)} USDT`} tone="good" />
        <Line
          k="Lời/lỗ nếu chạm cả hai"
          v={`${p.rewardR.toFixed(2)}R`}
          tone={rr.verdict === 'tot' ? 'good' : rr.verdict === 'kem' ? 'warn' : undefined}
        />
        {/* RR không phải mục tiêu để chọn — nó rơi ra từ chỗ các mốc cấu trúc
            nằm. Nên ở đây nó là một câu ĐỌC, kèm đúng số đo, chứ không phải một
            bộ lọc âm thầm bỏ kèo đi. */}
        <p
          className={`mt-1 text-2xs leading-snug ${
            rr.verdict === 'tot' ? 'text-emerald-300/80'
            : rr.verdict === 'kem' ? 'text-amber-300'
            : 'text-muted'
          }`}
        >
          {rr.verdict === 'kem' ? '⚠ ' : ''}{rr.text}
        </p>
      </div>

      {/* Đòn bẩy — chỗ người ta cháy tài khoản, nên nó có khối riêng. */}
      <div className={`px-3 py-2 ${nguyHiem ? 'bg-red-500/10' : ''}`}>
        <Line k="Stop cách entry" v={`${p.slPct.toFixed(2)}%`} />
        <Line k="Ký quỹ chiếm" v={`${p.margin.toFixed(0)} USDT · ${p.marginPct.toFixed(1)}% vốn`} tone={p.khongDuVon ? 'bad' : undefined} />
        <Line k="Thanh lý quanh" v={px(p.liqPrice)} tone={p.chayTruocStop ? 'bad' : p.vuotDonBay ? 'warn' : undefined} />
        <Line
          k="Đòn bẩy tối đa an toàn"
          v={`${p.maxSafeLeverage.toFixed(1)}×`}
          tone={p.vuotDonBay ? 'bad' : 'good'}
        />
        {/* Hai mức độ khác nhau, phải nói đúng cái nào — ở 50× thanh lý VẪN
            nằm ngoài stop, chỉ là đệm mỏng; nói "cháy trước stop" ở đó là sai. */}
        {p.chayTruocStop ? (
          <p className="mt-1.5 text-2xs leading-snug text-red-300">
            ⚠ Đòn bẩy {p.leverage}× quá cao cho stop {p.slPct.toFixed(2)}%. Sàn thanh lý quanh{' '}
            {px(p.liqPrice)} — <b>nằm trong stop {px(p.sl)}, tức cháy trước khi stop kịp chạy</b>.
            Bạn sẽ mất nhiều hơn {p.riskMoney.toFixed(0)} USDT đã chọn. Hạ xuống{' '}
            {Math.floor(p.maxSafeLeverage)}× hoặc thấp hơn.
          </p>
        ) : p.vuotDonBay ? (
          <p className="mt-1.5 text-2xs leading-snug text-amber-300">
            ⚠ Đòn bẩy {p.leverage}× cho stop {p.slPct.toFixed(2)}%: thanh lý ({px(p.liqPrice)}) vẫn
            nằm ngoài stop ({px(p.sl)}), nhưng đệm còn rất mỏng — phí, funding và trượt giá có thể
            ăn hết chỗ đó. An toàn ở {Math.floor(p.maxSafeLeverage)}× trở xuống.
          </p>
        ) : null}
        {p.khongDuVon && (
          <p className="mt-1.5 text-2xs leading-snug text-red-300">
            ⚠ Ký quỹ {p.margin.toFixed(0)} USDT vượt quá vốn. Tăng đòn bẩy hoặc giảm rủi ro mỗi lệnh.
          </p>
        )}
      </div>

      <details className="border-t border-line">
        <summary className="tap-sm flex items-center justify-between px-3 text-2xs text-muted">
          <span>Điều kiện vào và huỷ{c.warnings.length ? ` · ${c.warnings.length} cảnh báo` : ''}</span>
          <span aria-hidden className="text-sm">›</span>
        </summary>
        <div className="space-y-1.5 border-t border-line px-3 py-2 text-2xs leading-relaxed">
          <p className="text-slate-300"><b className="text-slate-400">Vào khi:</b> {c.trigger}</p>
          <p className="text-slate-300"><b className="text-slate-400">Huỷ khi:</b> {c.invalidation}</p>
          {c.warnings.map((w, k) => (
            <p key={k} className="text-amber-300">⚠ {w}</p>
          ))}
        </div>
      </details>
    </article>
  );
}

export default function VaoTienPage() {
  const [equity, setEquity] = useState(1000);
  const [riskPct, setRiskPct] = useState(1);
  const [leverage, setLeverage] = useState(10);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [clock, setClock] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(apiPath('scan', { symbols: ALWAYS_INCLUDE.join(',') }));
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'quét lỗi');
      setRows(j.symbols.map((s: Row & { direction: Record<TF, Call | null> }) => ({
        symbol: s.symbol, price: s.price, direction: s.direction,
      })));
      setUpdated(j.ictTime ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    setClock(ictString());
    const t = setInterval(() => setClock(ictString()), 1000);
    return () => clearInterval(t);
  }, []);

  // CHỈ kèo qua cửa, và chỉ kèo dựng được thành lệnh hợp lệ.
  const setups = useMemo<Setup[]>(() => {
    const out: Setup[] = [];
    for (const r of rows) {
      for (const tf of TFS) {
        const c = r.direction?.[tf];
        if (!c?.tradeable) continue;
        const plan = planOrder({
          side: c.side, entry: c.entry, sl: c.sl, tp1: c.tp1, tp2: c.tp2,
          equity, riskPct, leverage,
        });
        if (plan) out.push({ symbol: r.symbol, tf, call: c, plan });
      }
    }
    // Kèo mạnh trước, rồi tới khung lớn.
    const rank = (s: Setup) => (s.call.golden ? 100 : 0) + Math.abs(s.call.net);
    return out.sort((a, b) => rank(b) - rank(a));
  }, [rows, equity, riskPct, leverage]);

  const tongRuiRo = setups.reduce((s, x) => s + x.plan.riskMoney, 0);

  return (
    <div className="min-h-screen">
      <header className="safe-t sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="safe-x mx-auto max-w-[1100px] py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight">Bảng vào tiền</h1>
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
        </div>
      </header>

      <main className="safe-x safe-b mx-auto max-w-[1100px] pt-3">
        <div className="mb-3 flex gap-2">
          <NumField label="Vốn" value={equity} onChange={setEquity} suffix="USDT" step="100" />
          <NumField label="Rủi ro mỗi lệnh" value={riskPct} onChange={setRiskPct} suffix="%" step="0.1" />
          <NumField label="Đòn bẩy" value={leverage} onChange={setLeverage} suffix="×" step="1" />
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-red-600/40 bg-red-600/10 px-3 py-2 text-2xs text-red-300">
            ⚠ {err}
          </div>
        )}

        {setups.length > 0 && (
          <p className="mb-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-2xs leading-snug text-muted">
            <b className="text-white">{setups.length} kèo qua cửa.</b> Vào hết thì tổng rủi ro{' '}
            <b className="text-white">{tongRuiRo.toFixed(0)} USDT</b> ({((tongRuiRo / equity) * 100).toFixed(1)}% vốn)
            — và đó là khi các kèo đi độc lập, còn crypto thì thường cùng chiều.
          </p>
        )}

        <div className="grid gap-3 board:grid-cols-2">
          {setups.map((s) => (
            <SetupCard key={`${s.symbol}-${s.tf}`} s={s} />
          ))}
        </div>

        {setups.length === 0 && !busy && (
          <div className="rounded-xl border border-line bg-panel px-4 py-8 text-center">
            <p className="text-sm text-white">Không kèo nào qua cửa lúc này.</p>
            <p className="mt-2 text-2xs leading-relaxed text-muted">
              Đây là kết quả bình thường, không phải lỗi. Cửa chất lượng giữ lại khoảng 7% số
              kèo. Bảng này cố ý không hiện phần còn lại — muốn xem thiên hướng của mọi mã thì
              sang <a href="/" className="underline">bản điện</a>.
            </p>
          </div>
        )}

        {/* Con số kỳ vọng, nói đúng mức. Đặt ở CUỐI vì nó là thứ phải đọc, không
            phải thứ để liếc. */}
        <section className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-2xs leading-relaxed text-amber-100/90">
          <p className="mb-1.5 font-semibold text-amber-200">Kỳ vọng của lớp kèo này, đo được</p>
          <p>
            Cửa chất lượng này là cấu hình <b>duy nhất</b> vừa dương vừa đủ mẫu để tin: trên
            5.476 lệnh (6 mã × 15m/1h/4h × 3000 nến, bộ mô phỏng đã sửa hai lỗi), cửa giữ lại
            384 lệnh với <b>avgR 0,18</b>, và nửa mẫu ngoài <b>avgR 0,31 · PF 2,14</b> trên 192 lệnh.
          </p>
          <p className="mt-1.5">
            Nghĩa là: mỗi lệnh <b>trung bình</b> lãi khoảng 0,2–0,3 lần số tiền rủi ro — và chỉ
            đúng khi đi <b>đủ dài</b>. Tỷ lệ thắng quanh 55–60%, nên bốn năm lệnh thua liên tiếp
            là chuyện bình thường chứ không phải hệ hỏng.
          </p>
          <p className="mt-1.5 text-amber-200/70">
            Con số này đo trên nến spot, mù phái sinh, và trên 62 ngày gần nhất của 6 mã. Nó
            không phải lời hứa cho kèo đang hiện trên màn hình.
          </p>
        </section>

        <p className="mt-4 text-center text-2xs text-muted">
          Cập nhật {updated ?? '—'} · <a href="/" className="underline">bản điện</a> ·{' '}
          <a href="/strict" className="underline">bảng kỷ luật</a>
        </p>
      </main>
    </div>
  );
}
