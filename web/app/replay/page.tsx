'use client';

/**
 * REPLAY — dựng lại đúng các thẻ ENAUSDT đã in sai ngày 11–12/09/2026, chạy qua
 * ĐÚNG hàm vòng đời và ĐÚNG component mà bản điện dùng. Không phải ảnh chụp
 * tĩnh: nếu ai đó làm hỏng lại cổng, trang này đổi theo ngay.
 */
import { Detail } from '@/components/LiveBoard';
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
  symbol: 'ENAUSDT', rr: 1.2, atr1h: 0.0025,
  low24h: 0.13, high24h: 0.16, low4hMaxVol: 0.13, high4hMaxVol: 0.16,
  cum1h: null, rejected1h: true, tp1OutsideVa: false, volRatio: 1.2,
  opposingLegs: 2, tpBreaksUnbackedLevel: false, barsSinceIssued: 1,
};

function canh2234() {
  resetKhoaHet();
  const ts = Date.parse('2026-09-11T22:34:00Z');
  return [
    mk({
      ...chung, tf: '4h', side: 'SHORT', last: 0.154, ts,
      entryLow: 0.147, entryHigh: 0.150, sl: 0.15254, tp1: 0.140, tp2: 0.133,
      triggerText: '4H đóng dưới 0.1470', triggerLevel: 0.147,
      openK: bar(0.154, 0.15764, 0.1398, 0.154, 7.3e8, false),
      lastClosedK: bar(0.150, 0.156, 0.150, 0.154, 2.0e8, true),
    }, {}, 'Trước khi vá: SHORT · hạng A · QUA CỬA — trong khi nến 4H còn mở, last 0.154 đã trên SL 0.15254, và trigger "4H đóng dưới 0.1470" chưa xảy ra.'),
    mk({
      ...chung, tf: '15m', side: 'LONG', last: 0.1489, ts: Date.parse('2026-09-11T22:59:00Z'),
      entryLow: 0.151, entryHigh: 0.1515, sl: 0.14984, tp1: 0.156, tp2: 0.160,
      triggerText: '15m đóng trên 0.15150', triggerLevel: 0.1515,
      openK: null, lastClosedK: bar(0.150, 0.1502, 0.1485, 0.1487, 1e7, true),
    }, { side: 'LONG', longScore: 61, shortScore: 39, net: 22 },
      'Trước khi vá: LONG với last 0.14890 NẰM DƯỚI SL 0.14984, trigger đã FAIL (cây 22:45 đóng 0.1487), banner vẫn ghi "hướng vẫn LONG".'),
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

export default function Page() {
  return (
    <main className="safe-x safe-b mx-auto max-w-[900px] pt-4">
      <h1 className="mb-1 text-base font-semibold">Replay ENAUSDT · 11–12/09/2026</h1>
      <p className="mb-4 text-2xs text-muted">
        Cùng dữ liệu đã làm thẻ in sai, chạy qua hàm vòng đời và component hiện tại.
      </p>
      <Canh ten="11/09 22:34 — 22:59" thes={canh2234()} />
      <Canh ten="12/09 07:32 — cả bốn khung" thes={canh0732()} />
    </main>
  );
}
