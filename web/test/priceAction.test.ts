import { describe, expect, it } from 'vitest';
import { analyzePriceAction, atr, median, wickCluster } from '@/lib/priceAction';
import { buildFunding, buildOI, buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import { classifyStage, decideBias } from '@/lib/decide';
import { flat, mkCandles, noDerivatives, type Spec } from './fixtures';

const okxEmpty = { ok: false, fundingRate: null, nextFundingTime: null, markPrice: null, oiUsd: null, oiHistUsd: null, perpVol24hUsd: null };
const perpDead = { alive: false, reason: 'HTTP 451', fundingRate: null, fundingHistory: null, nextFundingTime: null, markPrice: null, openInterest: null, oiHist: null, oiUsd: null, vol24hUsd: null };

describe('accept vs grab', () => {
  it('wick ra ngoài range rồi đóng trong = grab, không phải break', () => {
    const pa = analyzePriceAction(mkCandles([
      ...flat(24, 100, 100),
      { o: 100.2, h: 106, l: 100, c: 100.3, v: 500 },
    ]));
    expect(pa.grab).toBe('up');
    expect(pa.acceptedOutside).toBeNull();
  });

  it('close giữ ngoài range = accept', () => {
    const pa = analyzePriceAction(mkCandles([
      ...flat(24, 100, 100),
      { o: 100.2, h: 106, l: 100, c: 105.5, v: 500 },
    ]));
    expect(pa.acceptedOutside).toBe('up');
    expect(pa.grab).toBeNull();
  });

  it('equal highs được nhận diện làm túi SL', () => {
    const specs: Spec[] = [];
    for (let i = 0; i < 8; i++) specs.push({ o: 99, h: 99.5, l: 98.5, c: 99, v: 100 });
    specs.push({ o: 99, h: 102.0, l: 99, c: 99.5, v: 200 });
    for (let i = 0; i < 6; i++) specs.push({ o: 99, h: 99.5, l: 98.5, c: 99, v: 100 });
    specs.push({ o: 99, h: 102.01, l: 99, c: 99.5, v: 200 });
    for (let i = 0; i < 6; i++) specs.push({ o: 99, h: 99.5, l: 98.5, c: 99, v: 100 });
    const pa = analyzePriceAction(mkCandles(specs));
    expect(pa.equalHighs.length).toBeGreaterThan(0);
    expect(Math.abs(pa.equalHighs[0] - 102)).toBeLessThan(0.1);
  });

  it('tín hiệu nến chỉ được tin khi volume ≥ median 20', () => {
    const weak = analyzePriceAction(mkCandles([
      ...flat(24, 100, 100),
      { o: 100, h: 101.5, l: 99.9, c: 100.05, v: 5 },   // pin bear nhưng vol teo
    ]));
    expect(weak.signal).toBe('pin-bear');
    expect(weak.signalHasVolume).toBe(false);
  });

  it('atr và median hoạt động trên chuỗi phẳng', () => {
    const cs = mkCandles(flat(30, 100, 100));
    expect(atr(cs)).toBeGreaterThan(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(wickCluster(cs, 110, 'above')).toBe(110);   // không có wick gần → trả lại chính mức đó
    expect(wickCluster(cs, 100.4, 'above')).toBeCloseTo(100.5, 6);   // có wick trong dung sai → bám wick
  });
});

describe('giá rời hẳn value', () => {
  // Value cũ quanh 100; giá chạy lên 130 rồi ĐỨNG YÊN ở đó. Không còn break mới,
  // nhưng VA của cửa sổ vẫn nằm tận 100 — mọi mép của profile này đều vô dụng.
  const specs: Spec[] = [
    ...flat(60, 100, 100),
    ...Array.from({ length: 25 }, (_, i) => ({
      o: 100 + i * 1.2, h: 101 + i * 1.2, l: 99.5 + i * 1.2, c: 100.8 + i * 1.2, v: 40,
    })),
    ...flat(25, 130, 40),
  ];
  const candles = mkCandles(specs);
  const closed = candles.filter((c) => c.closed);
  const vp = computeVolumeProfile(closed, { binSize: 0.5 })!;
  const pa = analyzePriceAction(candles);
  const last = closed[closed.length - 1].c;

  it('không được gọi là edge-fail — không còn mép để bám', () => {
    expect(last).toBeGreaterThan(vp.va70.high);
    expect(classifyStage(vp, pa, last)).toBe('mid-range');
  });

  it('→ WAIT, không in TP cách giá hàng chục phần trăm', () => {
    const rec = decideBias({
      symbol: 'T', tf: '4h', candles, vp, pa,
      delta: buildDelta(candles, vp, 'binance-spot'),
      deriv: noDerivatives(), htf: null, hasClosedBar: true, last,
    });
    expect(rec.bias).toBe('WAIT');
    expect(rec.tp1).toBeNull();
    expect(rec.reasons.join(' ')).toContain('rời hẳn');
  });
});

describe('OI + funding', () => {
  it('funding thiếu → UNAVAILABLE, ghi N/A', () => {
    const f = buildFunding(perpDead, okxEmpty);
    expect(f.quality).toBe('UNAVAILABLE');
    expect(f.rate).toBeNull();
    expect(f.note).toContain('N/A');
  });

  it('|FR| < 0.02%/8h → flat, và note nói rõ không làm lý do', () => {
    const f = buildFunding(perpDead, { ...okxEmpty, fundingRate: 0.00005 });
    expect(f.flat).toBe(true);
    expect(f.extreme).toBe(false);
    expect(f.note).toContain('không làm lý do');
  });

  it('OI ↓ + giá ↓ = long cover; OI ↓ + giá ↑ = short cover', () => {
    const hist = (from: number, to: number) => {
      const now = Date.now();
      return [
        { t: now - 25 * 3_600_000, oi: from },
        { t: now - 2 * 3_600_000, oi: from },
        { t: now, oi: to },
      ];
    };
    const down = buildOI(perpDead, { ...okxEmpty, oiUsd: 90, oiHistUsd: hist(100, 90) }, -1.5, -3, 1000);
    expect(down.read).toBe('long-cover');

    const cover = buildOI(perpDead, { ...okxEmpty, oiUsd: 90, oiHistUsd: hist(100, 90) }, 1.5, 3, 1000);
    expect(cover.read).toBe('short-cover');

    const newLongs = buildOI(perpDead, { ...okxEmpty, oiUsd: 110, oiHistUsd: hist(100, 110) }, 1.5, 3, 1000);
    expect(newLongs.read).toBe('new-longs');
  });

  it('OI thiếu hoàn toàn → N/A, không đọc bừa', () => {
    const oi = buildOI(perpDead, okxEmpty, 2, 5, 1000);
    expect(oi.quality).toBe('UNAVAILABLE');
    expect(oi.read).toBe('na');
    expect(oi.note).toContain('N/A');
  });

  it('OI/vol24h cao bất thường → cảnh báo squeeze, không phải tín hiệu', () => {
    const oi = buildOI(perpDead, { ...okxEmpty, oiUsd: 5000 }, 0, 0, 1000);
    expect(oi.squeezeWarning).toBe(true);
    expect(oi.oiOverVol).toBeCloseTo(5, 6);
    expect(oi.note).toContain('KHÔNG phải tín hiệu vào lệnh');
  });

  it('Binance perp sống → OI/vol dùng volume perp Binance, không mượn số của OKX', () => {
    const now = Date.now();
    const perpAlive = {
      alive: true, reason: 'binance-fapi', fundingRate: 0.0001, fundingHistory: null, nextFundingTime: null,
      markPrice: 100, openInterest: 1000, oiUsd: 300, vol24hUsd: 100,
      oiHist: [
        { t: now - 25 * 3_600_000, oi: 900 },
        { t: now - 2 * 3_600_000, oi: 900 },
        { t: now, oi: 1000 },
      ],
    };
    // mẫu số của OKX cố tình lệch hẳn — nếu bị dùng nhầm thì tỷ lệ sẽ ra 0.03
    const oi = buildOI(perpAlive, { ...okxEmpty, oiUsd: 999, perpVol24hUsd: 10_000 }, 1, 2, 10_000);
    expect(oi.venue).toBe('binance-perp');
    expect(oi.oiOverVol).toBeCloseTo(3, 6);
    expect(oi.squeezeWarning).toBe(true);
  });

  it('không có volume PERP thì không tính OI/vol — cấm lấy volume spot làm mẫu số', () => {
    const oi = buildOI(perpDead, { ...okxEmpty, oiUsd: 5000 }, 0, 0, null);
    expect(oi.oiOverVol).toBeNull();
    expect(oi.squeezeWarning).toBe(false);
  });
});

describe('delta', () => {
  it('có taker buy → REAL và nhãn chợ spot', () => {
    const cs = mkCandles(flat(30, 100, 100).map((s) => ({ ...s, tb: 60 })));
    const vp = computeVolumeProfile(cs, { binSize: 0.1 })!;
    const d = buildDelta(cs, vp, 'binance-spot');
    expect(d.quality).toBe('REAL');
    expect(d.note).toContain('SPOT');
    expect(d.cvd).toBeGreaterThan(0);       // 60 mua / 40 bán mỗi cây
    expect(d.deltaAtPrice.length).toBeGreaterThan(0);
  });

  it('không có taker → PROXY, gắn nhãn rõ', () => {
    const cs = mkCandles(flat(30, 100, 100));   // tb = null
    const vp = computeVolumeProfile(cs, { binSize: 0.1 })!;
    const d = buildDelta(cs, vp, 'binance-spot');
    expect(d.quality).toBe('PROXY');
    expect(d.note).toContain('PROXY');
  });
});
