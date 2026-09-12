'use client';

/**
 * CHUYÊN TRANG BTC · BNB — phân phối lợi suất phía trước, đặt cạnh mốc vô điều
 * kiện, kèm sai số của HIỆU.
 *
 * Trang này CỐ Ý không đưa ra một hướng. Nó đưa ra một phân phối, và nói thẳng
 * khi trạng thái hôm nay không dịch được phân phối đó ra khỏi ngẫu nhiên — đó
 * là kết quả thường gặp nhất, và là một câu trả lời hợp lệ.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { STATE_NHAN, STATE_O } from '@/components/ui';
import { apiPath } from '@/config/site';
import { fmtPrice, ictString } from '@/lib/format';
import type { TF } from '@/lib/types';

const TFS: TF[] = ['15m', '1h', '4h', '1d'];
const MA = ['BTCUSDT', 'BNBUSDT'];

type TomTat = { n: number; pTang: number; tb: number; q10: number; q25: number; q50: number; q75: number; q90: number };
type Dong = {
  ten: string; gio: number; voDieuKien: TomTat; coDieuKien: TomTat | null;
  sosanh: { dP: number; seP: number; dTb: number; dangKe: boolean } | null;
  ketLuan: string;
};
type Ma = {
  symbol: string; gia: number | null; o: string | null; moTaO: string | null;
  trangThai: { viTri: number; bienDong: number; soVoiTB: number } | null;
  tuNgay: string; denNgay: string; soNen: number; chanTroi: Dong[]; loi: string | null;
};
type The = { side: string; net: number; entry: [number, number]; sl: number; tp1: number;
  lifecycle: { state: string; banner: string; reason: string; grade: string; failedGates: string[] } | null };
type Quet = { symbol: string; price: number | null; change24h: number | null;
  direction: Record<TF, The | null>; derivatives: { funding: { rate: number | null; history: { text: string } | null };
  oi: { read: string; chg24h: number | null } } };

const pc = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;

export default function Page() {
  const [pt, setPt] = useState<Ma[] | null>(null);
  const [quet, setQuet] = useState<Quet[] | null>(null);
  const [meta, setMeta] = useState<{ taoBangLuc: number; nguon: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    setClock(ictString());
    const t = setInterval(() => setClock(ictString()), 1000);
    return () => clearInterval(t);
  }, []);

  const nap = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const [a, b] = await Promise.all([
        fetch(apiPath('phan-tich', { symbols: MA.join(',') })).then((r) => r.json()),
        fetch(apiPath('scan', { symbols: MA.join(',') })).then((r) => r.json()),
      ]);
      if (a.ok) { setPt(a.ma); setMeta({ taoBangLuc: a.taoBangLuc, nguon: a.nguon }); }
      else setErr(a.error ?? 'không đọc được phân tích');
      if (b.ok) setQuet(b.symbols);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, []);

  useEffect(() => { void nap(); }, [nap]);

  return (
    <main className="safe-x safe-b mx-auto max-w-[1000px] pt-3">
      <header className="mb-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold sm:text-lg">Phân tích sâu · BTC &amp; BNB</h1>
            <p className="text-2xs text-muted">
              Phân phối lợi suất phía trước, đặt cạnh mốc vô điều kiện, kèm sai số của hiệu.
            </p>
          </div>
          <div className="mono text-xs text-muted">{clock ?? '—'}</div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href="../" className="text-2xs text-sky-300 underline hover:brightness-125">← Bản điện</a>
          <a href="../vao-tien/" className="text-2xs text-emerald-300 underline hover:brightness-125">Bảng vào tiền →</a>
          <button
            onClick={() => void nap()} disabled={busy}
            className="tap-sm rounded-full border border-sky-600/50 bg-sky-600/20 px-4 text-xs font-semibold text-sky-200 hover:brightness-125 disabled:opacity-50"
          >
            {busy ? 'Đang tính…' : 'Tính lại'}
          </button>
        </div>
      </header>

      {/* Cách đọc — đặt TRƯỚC số, vì đọc sai cách thì số càng nhiều càng hại. */}
      <details className="mb-3 rounded-lg border border-sky-600/40 bg-sky-600/10" open>
        <summary className="tap flex items-center justify-between gap-2 px-3 text-2xs font-semibold text-sky-200">
          <span>Cách đọc trang này</span><span aria-hidden className="text-base leading-none">›</span>
        </summary>
        <div className="space-y-1.5 border-t border-sky-600/30 px-3 py-2.5 text-2xs leading-relaxed text-sky-100/90">
          <p>
            Một con số như <b>&ldquo;P(tăng) = 55%&rdquo;</b> tự nó vô nghĩa. Nó chỉ có nghĩa khi đặt
            cạnh mốc <b>vô điều kiện</b>: nếu vô điều kiện cũng 53% thì phần thông tin thật chỉ là
            2 điểm phần trăm — và trên vài trăm mẫu, 2 điểm đó nằm gọn trong sai số.
          </p>
          <p>
            Cột <b>n</b> đếm <b>đoạn độc lập</b>, không phải số nến. Vài nghìn cửa sổ 7 ngày trùng
            nhau chỉ chứa vài chục đoạn thật sự độc lập; đếm theo nến sẽ làm sai số nhỏ đi khoảng
            mười lần và mọi thứ đều trông như có tín hiệu.
          </p>
          <p className="text-sky-200">
            Kết luận thường gặp nhất là <b>&ldquo;không nói được gì&rdquo;</b>. Đó là một câu trả lời
            hợp lệ, không phải câu trả lời thiếu.
          </p>
        </div>
      </details>

      {err && <div className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-2xs text-red-300">⚠ {err}</div>}

      {!pt && !err && <p className="text-2xs text-muted">Đang nạp…</p>}

      {pt?.map((m) => {
        const q = quet?.find((x) => x.symbol === m.symbol);
        return (
          <section key={m.symbol} className="mb-5 rounded-xl border border-line bg-panel p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="mono text-sm font-semibold">{m.symbol}</h2>
              <span className="mono text-sm">{fmtPrice(m.gia ?? q?.price ?? null, m.symbol === 'BTCUSDT' ? 1 : 0.01)}</span>
              {q?.change24h != null && (
                <span className={`mono text-2xs ${q.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pc(q.change24h / 100)} 24h
                </span>
              )}
              {m.moTaO && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">{m.moTaO}</span>}
            </div>

            {m.loi && <p className="rounded border border-amber-600/40 bg-amber-600/10 px-2 py-1.5 text-2xs text-amber-200">⚠ {m.loi}</p>}

            {m.trangThai && (
              <p className="mb-2 text-2xs text-muted">
                Vị trí trong biên 5 ngày <b className="text-slate-300">{(m.trangThai.viTri * 100).toFixed(0)}%</b>
                {' · '}biến động giờ <b className="text-slate-300">{(m.trangThai.bienDong * 100).toFixed(2)}%</b>
                {' · '}so với TB240 <b className="text-slate-300">{pc(m.trangThai.soVoiTB, 2)}</b>
                {' — '}mẫu {m.tuNgay} → {m.denNgay}, {m.soNen.toLocaleString('vi')} nến 1H
              </p>
            )}

            {/* Cổng của hệ — thiên hướng và được-mở-lệnh là hai câu khác nhau. */}
            {q && (
              <div className="mb-3 grid gap-1 sm:grid-cols-2">
                {TFS.map((tf) => {
                  const c = q.direction?.[tf];
                  const lc = c?.lifecycle;
                  return (
                    <div key={tf} className={`rounded-md border px-2 py-1 text-2xs ${STATE_O[lc?.state ?? 'CAM']}`}>
                      <b className="mono">{tf}</b>{' '}
                      {c ? <>{c.side} · {lc ? STATE_NHAN[lc.state] : 'chưa đánh giá'}{lc?.failedGates.length ? ` [${lc.failedGates.join(',')}]` : ''}</> : 'không có thẻ'}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="scroll-x">
              <table className="tbl w-full text-xs">
                <thead>
                  <tr>
                    <th>Chân trời</th><th>Nhóm</th><th className="text-right">n</th>
                    <th className="text-right">P(tăng)</th><th className="text-right">TB</th>
                    <th className="text-right">q10</th><th className="text-right">q50</th><th className="text-right">q90</th>
                  </tr>
                </thead>
                <tbody>
                  {m.chanTroi.map((d) => (
                    <Fragment key={d.ten}>
                      <tr>
                        <td className="mono" rowSpan={d.coDieuKien ? 2 : 1}>{d.ten}</td>
                        <td className="text-muted">vô điều kiện</td>
                        <td className="mono text-right text-muted">{d.voDieuKien.n}</td>
                        <td className="mono text-right text-muted">{(d.voDieuKien.pTang * 100).toFixed(1)}%</td>
                        <td className="mono text-right text-muted">{pc(d.voDieuKien.tb, 2)}</td>
                        <td className="mono text-right text-red-300/70">{pc(d.voDieuKien.q10)}</td>
                        <td className="mono text-right text-muted">{pc(d.voDieuKien.q50)}</td>
                        <td className="mono text-right text-emerald-300/70">{pc(d.voDieuKien.q90)}</td>
                      </tr>
                      {d.coDieuKien && (
                        <tr>
                          <td className="font-semibold">giống hôm nay</td>
                          <td className="mono text-right font-semibold">{d.coDieuKien.n}</td>
                          <td className="mono text-right font-semibold">{(d.coDieuKien.pTang * 100).toFixed(1)}%</td>
                          <td className="mono text-right font-semibold">{pc(d.coDieuKien.tb, 2)}</td>
                          <td className="mono text-right text-red-300">{pc(d.coDieuKien.q10)}</td>
                          <td className="mono text-right">{pc(d.coDieuKien.q50)}</td>
                          <td className="mono text-right text-emerald-300">{pc(d.coDieuKien.q90)}</td>
                        </tr>
                      )}
                      <tr>
                        <td colSpan={8} className={`text-2xs leading-snug ${d.sosanh?.dangKe ? 'text-amber-200' : 'text-slate-400'}`}>
                          {d.sosanh?.dangKe ? '◆ ' : '– '}{d.ketLuan}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {q && (
              <p className="mt-2 text-2xs text-muted">
                Funding {q.derivatives.funding.rate != null ? `${(q.derivatives.funding.rate * 100).toFixed(4)}%/8h` : 'N/A'}
                {q.derivatives.funding.history ? ` · ${q.derivatives.funding.history.text}` : ''}
                {' · '}OI {q.derivatives.oi.read}{q.derivatives.oi.chg24h != null ? ` ${pc(q.derivatives.oi.chg24h / 100, 1)} 24h` : ''}
              </p>
            )}
          </section>
        );
      })}

      {meta && (
        <p className="mb-4 text-2xs leading-relaxed text-muted">
          Bảng phân phối dựng lúc {new Date(meta.taoBangLuc).toISOString().slice(0, 16).replace('T', ' ')} UTC
          {' · '}nguồn {meta.nguon}. Trạng thái hôm nay tính từ nến 1H mới nạp mỗi lần bấm Tính lại.
          {' '}Bảng dựng offline vì quét 43 nghìn nến mỗi lượt truy cập là không khả thi — phân phối
          lịch sử đổi rất chậm, còn trạng thái hôm nay thì vài trăm nến là đủ.
        </p>
      )}

      <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-2xs leading-relaxed text-amber-100/90">
        <b className="text-amber-200">Giới hạn phải biết.</b> Phân phối trên là lịch sử 5 năm của
        chính hai mã này, <b>không có biến sự kiện vĩ mô</b>. Một cuộc họp lãi suất nằm trong chân
        trời 3 hoặc 7 ngày sẽ làm đuôi rộng hơn con số ở đây, không hẹp hơn. Ba ngưỡng chia ô
        (vị trí, biến động, trung bình 240) do người viết đặt trước và <b>chưa hiệu chuẩn</b> —
        kết luận &ldquo;không có tín hiệu&rdquo; thì bền với chuyện đó, nhưng ngày nào hiện ra tín
        hiệu thật thì phải quét ngưỡng trước khi tin.
      </p>
    </main>
  );
}
