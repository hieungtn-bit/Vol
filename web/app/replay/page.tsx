'use client';

/**
 * REPLAY — dựng lại đúng các thẻ ENAUSDT đã in sai ngày 11–12/09/2026, chạy qua
 * ĐÚNG hàm vòng đời và ĐÚNG component mà bản điện dùng. Không phải ảnh chụp
 * tĩnh: nếu ai đó làm hỏng lại cổng, trang này đổi theo ngay.
 */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Detail } from '@/components/LiveBoard';
import { STATE_NHAN, STATE_O } from '@/components/ui';
import { evaluate, resetKhoaHet, type BarK, type LifecycleInput } from '@/lib/lifecycle';
import type { DirectionalCall } from '@/lib/direct';

const bar = (o: number, h: number, l: number, c: number, v: number, closed: boolean): BarK =>
  ({ t: 0, o, h, l, c, v, closed });

function mk(
  li: LifecycleInput,
  extra: Partial<DirectionalCall>,
  truoc: string,
): { call: DirectionalCall; truoc: string } {
  const call: DirectionalCall = {
    symbol: li.symbol, tf: li.tf, side: li.side,
    conviction: 'A', golden: false, goldenBlockers: ['độ lệch dưới 40'],
    unanimous: true, contestedBy: [], tradeable: true, gateBlockers: [],
    net: 34, longScore: 33, shortScore: 67,
    entry: [li.entryLow, li.entryHigh], sl: li.sl, tp1: li.tp1, tp2: li.tp2,
    rr1: 1.0, rr2: 1.6, rrBlended: li.rr, runner: null, size: 'Normal',
    trigger: li.triggerText, triggerLevel: li.triggerLevel,
    invalidation: `đóng nến ${li.tf} ${li.side === 'SHORT' ? 'trên' : 'dưới'} ${li.sl} thì hủy`,
    evidence: [
      { label: 'Cấu trúc HH/HL/LH/LL', side: 'short', points: -18, detail: 'LH + LL trên nến đã đóng' },
      { label: 'Taker perp', side: 'long', points: 6, detail: 'taker mua đang nhỉnh hơn — NGƯỢC hướng thẻ' },
      { label: 'Price Action', side: 'long', points: 5, detail: 'nến đóng nửa trên — NGƯỢC hướng thẻ' },
    ],
    structureNote: 'LH + LL, chỉ tính trên nến đã đóng',
    flowNote: '', fundingText: 'Funding quanh 0 nhưng đã ĐỔI DẤU 2 lần trong 8 kỳ — không phải phẳng.',
    buyPctPerp: 52, buyPctSpot: 51,
    warnings: [], planText: '', lifecycle: null,
    ...extra,
  };
  call.lifecycle = evaluate(li);
  return { call, truoc };
}

const chung = {
  symbol: 'ENAUSDT', rr: 1.2, atr1h: 0.0025, nenGanDay: [] as BarK[],
  low24h: 0.13, high24h: 0.16, low4hMaxVol: 0.13, high4hMaxVol: 0.16,
  cum1h: null, rejected1h: true, tp1OutsideVa: false, volRatio: 1.2,
  opposingLegs: 2, tpBreaksUnbackedLevel: false, barsSinceIssued: 1,
};

function canh2234() {
  resetKhoaHet();
  const ts = Date.parse('2026-09-11T22:34:00Z');
  return [
    mk({
      ...chung, tf: '4h', side: 'SHORT', last: 0.154, ts, rr: 0.49,
      entryLow: 0.147, entryHigh: 0.150, sl: 0.15254, tp1: 0.140, tp2: 0.133,
      triggerText: '4H đóng dưới 0.1470', triggerLevel: 0.147,
      // SL 0.15254 nằm giữa cụm 1H 20:00+21:00 → H6.
      cum1h: { low: 0.1505, high: 0.1566, bars: [Date.parse('2026-09-11T20:00:00Z')] },
      openK: bar(0.154, 0.15764, 0.1398, 0.154, 7.3e8, false),
      lastClosedK: bar(0.150, 0.156, 0.150, 0.154, 2.0e8, true),
    }, {}, 'Trước khi vá: SHORT · hạng A · in là đủ điều kiện vào tiền — trong khi nến 4H còn mở, last 0.154 đã trên SL 0.15254, và trigger "4H đóng dưới 0.1470" chưa xảy ra.'),
    mk({
      ...chung, tf: '15m', side: 'LONG', last: 0.1489, ts: Date.parse('2026-09-11T22:59:00Z'),
      entryLow: 0.151, entryHigh: 0.1515, sl: 0.14984, tp1: 0.156, tp2: 0.160,
      triggerText: '15m đóng trên 0.15150', triggerLevel: 0.1515,
      openK: null, lastClosedK: bar(0.150, 0.1502, 0.1485, 0.1487, 1e7, true),
    }, { side: 'LONG', longScore: 61, shortScore: 39, net: 22 },
      'Trước khi vá: LONG với last 0.14890 NẰM DƯỚI SL 0.14984, trigger đã FAIL (cây 22:45 đóng 0.1487), banner vẫn khẳng định hướng LONG.'),
  ];
}

function canh0732() {
  resetKhoaHet();
  const ts = Date.parse('2026-09-12T07:32:00Z');
  const c = { ...chung, ts, low24h: 0.13944, low4hMaxVol: 0.13944, side: 'SHORT' as const };
  return [
    mk({
      ...c, tf: '15m', last: 0.1405, rr: 0.26,
      entryLow: 0.1403, entryHigh: 0.1408, sl: 0.1425, tp1: 0.14, tp2: 0.139,
      triggerText: '15m đóng dưới 0.1403', triggerLevel: 0.1403,
      openK: null, lastClosedK: bar(0.1404, 0.1409, 0.1402, 0.1405, 1e7, true),
    }, { rrBlended: 0.26 }, 'Trước khi vá: hạng A với R kỳ vọng 0.26 và TP1 0.14000 gần như bằng giá 0.14050.'),
    mk({
      ...c, tf: '1h', last: 0.1405,
      entryLow: 0.141, entryHigh: 0.142, sl: 0.1445, tp1: 0.14016, tp2: 0.138,
      triggerText: '1H đóng dưới 0.1410', triggerLevel: 0.141,
      openK: null, lastClosedK: bar(0.14, 0.14036, 0.1399, 0.14036, 1e7, true),
    }, {}, 'Trước khi vá: cây 1H 06:00 đóng 0.14036 đúng CAO cây (nến xanh) mà vẫn khóa SHORT; TP1 0.14016 gần bằng giá.'),
    mk({
      ...c, tf: '4h', last: 0.1405, low24h: 0.13, low4hMaxVol: 0.13,
      entryLow: 0.142, entryHigh: 0.143, sl: 0.1465, tp1: 0.133, tp2: 0.128,
      triggerText: '4H đóng dưới 0.1420', triggerLevel: 0.142,
      openK: null, lastClosedK: bar(0.143, 0.1432, 0.14, 0.1405, 3e8, true),
    }, {}, 'Trước khi vá: in như một kèo short ngay, trong khi entry 0.142–0.143 nằm TRÊN giá 0.14050 — đúng ra là chờ kéo lại.'),
    mk({
      ...c, tf: '1d', last: 0.1405,
      entryLow: 0.14, entryHigh: 0.141, sl: 0.15, tp1: 0.111, tp2: 0.096,
      triggerText: '1D đóng dưới 0.1400', triggerLevel: 0.14,
      openK: null, lastClosedK: bar(0.145, 0.146, 0.139, 0.1405, 9e8, true),
      tpBreaksUnbackedLevel: true,
    }, {}, 'Trước khi vá: TP1 0.111 / TP2 0.096 xuyên cụm tháng — và ngày thì không được mở lệnh.'),
  ];
}

function canh0344() {
  resetKhoaHet();
  const cum = { low: 0.14, high: 0.1428, bars: [Date.parse('2026-09-12T02:00:00Z')] };
  return [
    mk({
      ...chung, tf: '15m', side: 'SHORT', last: 0.14101, ts: Date.parse('2026-09-12T03:44:00Z'),
      entryLow: 0.1405, entryHigh: 0.1415, sl: cum.high + 0.0001, tp1: 0.136, tp2: 0.132,
      triggerText: '15m đóng dưới 0.1405', triggerLevel: 0.1405,
      openK: null, lastClosedK: bar(0.1415, 0.1416, 0.14, 0.1402, 1e7, true),
      low24h: 0.13944, low4hMaxVol: 0.13944, atr1h: 0.00194, cum1h: cum,
    }, {}, 'Trước khi vá: short một cây sát đáy — last 0.14101 chỉ cách đáy 24h 0.13944 đúng 0.00157, nhỏ hơn ATR 1H 0.00194.'),
  ];
}

function canh0815() {
  resetKhoaHet();
  return [
    mk({
      ...chung, tf: '15m', side: 'SHORT', last: 0.14159, ts: Date.parse('2026-09-12T08:15:00Z'),
      entryLow: 0.1414, entryHigh: 0.1422, sl: 0.144, tp1: 0.138, tp2: 0.135,
      triggerText: '15m đóng dưới 0.1422', triggerLevel: 0.1422, rr: 1.3,
      openK: null, lastClosedK: bar(0.141, 0.142, 0.1405, 0.1418, 1e7, true),
      low24h: 0.13, low4hMaxVol: 0.13,
    }, {}, 'Trước khi vá: giữ SHORT trong khi cây 15m 08:00 đóng 0.1418 ở nửa TRÊN — nến khung thẻ đóng ngược hướng.'),
  ];
}

/**
 * Đường /strict — dựng thẻ từ Recommendation (bias + mức giá) qua ĐÚNG
 * `evaluate()` của bản điện. Không có máy trạng thái thứ hai; ở đây chỉ in ra
 * banner để đối chiếu với T13/T14.
 */
function theStrict(p: {
  tf: LifecycleInput['tf']; side: 'LONG' | 'SHORT';
  entry: [number, number]; sl: number; tp1: number; tp2: number;
  trigger: string; triggerLevel: number; rr1: number; rr2: number;
  over: Partial<LifecycleInput>; truoc: string;
}) {
  const li: LifecycleInput = {
    ...chung, tf: p.tf, side: p.side,
    entryLow: p.entry[0], entryHigh: p.entry[1], sl: p.sl, tp1: p.tp1, tp2: p.tp2,
    triggerText: p.trigger, triggerLevel: p.triggerLevel,
    rr: 0.5 * p.rr1 + 0.3 * p.rr2,
    last: 0, ts: 0, openK: null, lastClosedK: null,
    ...p.over,
  };
  return { li, v: evaluate(li), truoc: p.truoc };
}

function canhStrict() {
  resetKhoaHet();
  return [
    theStrict({
      tf: '4h', side: 'SHORT', entry: [0.147, 0.15], sl: 0.15254, tp1: 0.14, tp2: 0.133,
      trigger: '4H đóng dưới 0.1470', triggerLevel: 0.147, rr1: 1.0, rr2: 1.6,
      over: {
        last: 0.154, ts: Date.parse('2026-09-11T22:34:00Z'),
        openK: bar(0.154, 0.15764, 0.1398, 0.154, 7.3e8, false),
        lastClosedK: bar(0.15, 0.156, 0.15, 0.154, 2e8, true),
      },
      truoc: '22:34 — /strict trước đây chỉ đọc điểm hợp lưu, không biết nến 4H còn mở hay last đã xuyên SL.',
    }),
    theStrict({
      tf: '4h', side: 'SHORT', entry: [0.142, 0.143], sl: 0.1465, tp1: 0.133, tp2: 0.128,
      trigger: '4H đóng dưới 0.1420', triggerLevel: 0.142, rr1: 1.0, rr2: 1.6,
      over: {
        last: 0.1405, ts: Date.parse('2026-09-12T07:32:00Z'),
        openK: null, lastClosedK: bar(0.143, 0.1432, 0.14, 0.1405, 3e8, true),
        low24h: 0.13, low4hMaxVol: 0.13,
      },
      truoc: '07:32 — entry 0.142–0.143 nằm TRÊN giá 0.14050: chờ kéo lại, không phải short ngay.',
    }),
  ];
}

function CanhStrict() {
  const thes = canhStrict();
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-white">Đường /strict — cùng evaluate()</h2>
      <div className="space-y-3">
        {thes.map(({ li, v, truoc }, i) => (
          <div key={i}>
            <p className="mb-1 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-2xs leading-snug text-red-300/90">
              {truoc}
            </p>
            <div className="rounded-xl border border-line bg-panel2 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="mono rounded bg-white/10 px-1.5 py-0.5 text-xs font-semibold">{li.tf}</span>
                <span className="mono text-2xs text-muted">{li.side} · last {li.last} · SL {li.sl}</span>
              </div>
              <p className={`rounded-md border px-2 py-1.5 text-2xs leading-snug ${STATE_O[v.state]}`}>
                <b>{STATE_NHAN[v.state]}</b> · hạng {v.grade}
                <span className="mt-1 block">– {v.reason}</span>
                {v.failedGates.length > 0 && (
                  <span className="mt-0.5 block opacity-80">– cổng hỏng: {v.failedGates.join(', ')}</span>
                )}
              </p>
              <p className="mono mt-1.5 text-2xs text-muted">id {v.id}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Canh({ ten, thes }: { ten: string; thes: ReturnType<typeof canh2234> }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-white">{ten}</h2>
      <div className="space-y-3">
        {thes.map(({ call, truoc }, i) => (
          <div key={i}>
            <p className="mb-1 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-2xs leading-snug text-red-300/90">
              {truoc}
            </p>
            <Detail c={call} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Noi() {
  // ?mode=strict để xem riêng đường /strict; mặc định xem cả hai.
  const strictOnly = useSearchParams().get('mode') === 'strict';
  return (
    <main className="safe-x safe-b mx-auto max-w-[900px] pt-4">
      <h1 className="mb-1 text-base font-semibold">Replay ENAUSDT · 11–12/09/2026</h1>
      <p className="mb-4 text-2xs text-muted">
        Cùng dữ liệu đã làm thẻ in sai, chạy qua hàm vòng đời và component hiện tại.
        {strictOnly ? ' Đang xem riêng đường /strict.' : ''}
      </p>
      {!strictOnly && (
        <>
          <Canh ten="11/09 22:34 — 22:59" thes={canh2234()} />
          <Canh ten="12/09 03:44 — sát đáy 24h" thes={canh0344()} />
          <Canh ten="12/09 07:32 — cả bốn khung" thes={canh0732()} />
          <Canh ten="12/09 08:15 — nến 15m đóng ngược hướng" thes={canh0815()} />
        </>
      )}
      <CanhStrict />
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Noi /></Suspense>;
}
