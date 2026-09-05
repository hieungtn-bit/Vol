import type { Candle, Node, ValueArea, VolumeProfile, VPBin, VPMode } from './types';

// ============================================================
// Volume Profile
// Hai mode: 'close' (mặc định, volume dồn vào bin của giá đóng) và
// 'range' (volume rải đều từ low→high). Khi hai POC lệch nhau > 2 bin
// nghĩa là vài cây khối lượng lớn đang kéo POC-close — coi cả vùng là nhà.
// ============================================================

const MAX_BINS = 1200;
const MIN_BINS = 24;
const HVN_SHARE = 0.012;   // ≥1.2% tổng vol → đỉnh đáng gọi là nhà
const LVN_SHARE = 0.008;   // ≤0.8% → thung lũng
const NODE_DECAY = 0.5;    // biên node nới tới khi còn ≥50% đỉnh

/** Bước 1/2/5 để nới bin mà vẫn giữ số tròn đọc được. */
function niceStep(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const m = x / base;
  if (m <= 1) return base;
  if (m <= 2) return 2 * base;
  if (m <= 5) return 5 * base;
  return 10 * base;
}

/**
 * Bin mặc định theo bậc giá; ATR chỉ dùng để tinh chỉnh khi có.
 * BTC (giá 5–6 chữ số) rơi vào nhánh ≥1000 → 10 USD, nới dần khi range rộng.
 */
export function defaultBinSize(price: number, atr?: number): number {
  let base: number;
  if (price >= 10000) base = 10;
  else if (price >= 1000) base = 1;
  else if (price >= 100) base = 0.1;
  else if (price >= 10) base = 0.01;
  else if (price >= 1) base = 0.001;
  else if (price >= 0.1) base = 0.0005;
  else if (price >= 0.01) base = 0.0001;
  else base = 0.00001;

  if (atr && atr > 0) {
    // 0.1% ATR là mục tiêu; chỉ nới ra, không bao giờ mịn hơn bậc giá
    // (mịn hơn thì mỗi bin chỉ có 1 nến, profile thành nhiễu).
    const byAtr = niceStep(atr * 0.1);
    if (byAtr > base) base = byAtr;
  }
  return base;
}

export interface VPOptions {
  mode?: VPMode;
  binSize?: number;
  atr?: number;
  /** Bỏ nến chưa đóng khỏi profile. */
  includeOpenCandle?: boolean;
  /**
   * Sàn số bin trên TOÀN DẢI. Mặc định 24.
   *
   * Thước theo lớp (`lib/ruler.ts`) ràng buộc số bin trong VÙNG 70%, và hai
   * ràng buộc này đá nhau khi vùng 70% chiếm gần hết dải: sàn 24 bin toàn dải
   * ép bước mịn lại, làm vùng 70% không bao giờ xuống được dưới 25 bin. Lúc đó
   * phía gọi phải hạ sàn này xuống.
   */
  minBins?: number;
}

export function computeVolumeProfile(
  candlesIn: Candle[],
  opts: VPOptions = {},
): VolumeProfile | null {
  const mode: VPMode = opts.mode ?? 'close';
  const candles = opts.includeOpenCandle
    ? candlesIn
    : candlesIn.filter((c) => c.closed);
  if (candles.length === 0) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;

  const lastPrice = candles[candles.length - 1].c;
  let binSize = opts.binSize ?? defaultBinSize(lastPrice, opts.atr);
  let binNote: string | null = null;

  // Nới bin nếu range chia ra quá nhiều bin (BTC 15D chẳng hạn).
  if ((hi - lo) / binSize > MAX_BINS) {
    const target = (hi - lo) / MAX_BINS;
    const widened = niceStep(target);
    binNote = `Bin nới ${binSize} → ${widened} vì range ${fmt(lo)}–${fmt(hi)} chia ra > ${MAX_BINS} bin.`;
    binSize = widened;
  }
  // Siết lại nếu quá ít bin (cửa sổ ngắn, giá đứng im).
  const minBins = opts.minBins ?? MIN_BINS;
  while ((hi - lo) / binSize < minBins && binSize > 1e-9) {
    binSize = binSize / 2;
  }

  const start = Math.floor(lo / binSize) * binSize;
  const count = Math.max(1, Math.ceil((hi - start) / binSize) + 1);

  const vol = new Float64Array(count);
  const delta = new Float64Array(count);

  const idxOf = (p: number) => {
    const i = Math.floor((p - start) / binSize);
    return i < 0 ? 0 : i >= count ? count - 1 : i;
  };

  for (const c of candles) {
    const dir = c.c >= c.o ? 1 : -1;
    if (mode === 'close') {
      const i = idxOf(c.c);
      vol[i] += c.v;
      delta[i] += dir * c.v;
    } else {
      // rải đều volume trên các bin mà nến đi qua
      const a = idxOf(c.l);
      const b = idxOf(c.h);
      const n = b - a + 1;
      const per = c.v / n;
      for (let i = a; i <= b; i++) {
        vol[i] += per;
        delta[i] += dir * per;
      }
    }
  }

  let totalVol = 0;
  for (let i = 0; i < count; i++) totalVol += vol[i];
  if (totalVol <= 0) return null;

  const bins: VPBin[] = [];
  for (let i = 0; i < count; i++) {
    const low = start + i * binSize;
    bins.push({
      low,
      high: low + binSize,
      mid: low + binSize / 2,
      vol: vol[i],
      delta: delta[i],
      share: vol[i] / totalVol,
    });
  }

  let pocIdx = 0;
  for (let i = 1; i < count; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;

  const totalDelta = bins.reduce((s, b) => s + b.delta, 0);

  return {
    mode,
    binSize,
    binCount: count,
    binNote,
    bins,
    poc: bins[pocIdx].mid,
    va70: valueArea(bins, pocIdx, totalVol, 0.7),
    va80: valueArea(bins, pocIdx, totalVol, 0.8),
    hvn: findHVN(bins),
    lvn: findLVN(bins),
    totalVol,
    delta: totalDelta,
    from: candles[0].t,
    to: candles[candles.length - 1].t,
    candles: candles.length,
  };
}

/**
 * Value Area: mở rộng từ POC, mỗi bước lấy CẶP bin ở phía có volume lớn hơn.
 * Đây là cách TPO gốc — không phải cắt percentile, nên VA bám đúng hình profile.
 */
function valueArea(bins: VPBin[], pocIdx: number, totalVol: number, target: number): ValueArea {
  let up = pocIdx;
  let down = pocIdx;
  let acc = bins[pocIdx].vol;
  const need = totalVol * target;

  while (acc < need && (down > 0 || up < bins.length - 1)) {
    const upPair =
      (up + 1 < bins.length ? bins[up + 1].vol : 0) +
      (up + 2 < bins.length ? bins[up + 2].vol : 0);
    const downPair =
      (down - 1 >= 0 ? bins[down - 1].vol : 0) +
      (down - 2 >= 0 ? bins[down - 2].vol : 0);

    const canUp = up < bins.length - 1;
    const canDown = down > 0;
    if (!canUp && !canDown) break;

    if (upPair === downPair && canUp && canDown) {
      // Hoà (rất hay gặp khi hai bên đều là bin rỗng): nới ĐỀU hai phía.
      // Nếu luôn ưu tiên một bên, VA sẽ trườn về phía đó qua cả vùng không có
      // giao dịch và POC không còn nằm giữa value nữa.
      up += 2; down -= 2;
      up = Math.min(bins.length - 1, up);
      down = Math.max(0, down);
      acc += upPair + downPair;
    } else if (canUp && (upPair > downPair || !canDown)) {
      up = Math.min(bins.length - 1, up + 2);
      acc += upPair;
    } else if (canDown) {
      down = Math.max(0, down - 2);
      acc += downPair;
    } else break;
  }

  return {
    low: bins[down].low,
    high: bins[up].high,
    coverage: acc / totalVol,
  };
}

/**
 * HVN = đỉnh cục bộ share ≥ 1.2%. Biên node nới ra CHỈ KHI volume còn giảm dần
 * và còn ≥ 50% đỉnh → node dừng ở thung lũng thay vì nuốt cả range.
 */
export function findHVN(bins: VPBin[]): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    if (b.share < HVN_SHARE) continue;
    const prev = i > 0 ? bins[i - 1].vol : -1;
    const next = i < bins.length - 1 ? bins[i + 1].vol : -1;
    if (b.vol < prev || b.vol < next) continue;   // không phải đỉnh cục bộ

    const floor = b.vol * NODE_DECAY;
    let lo = i;
    while (lo > 0 && bins[lo - 1].vol <= bins[lo].vol && bins[lo - 1].vol >= floor) lo--;
    let hi = i;
    while (hi < bins.length - 1 && bins[hi + 1].vol <= bins[hi].vol && bins[hi + 1].vol >= floor) hi++;

    let v = 0;
    let s = 0;
    for (let k = lo; k <= hi; k++) {
      v += bins[k].vol;
      s += bins[k].share;
    }
    out.push({ price: b.mid, low: bins[lo].low, high: bins[hi].high, vol: v, share: s });
  }
  // gộp node chồng lấn để bản đồ S/R không mâu thuẫn với phần quyết định
  out.sort((a, b) => a.low - b.low);
  const merged: Node[] = [];
  for (const n of out) {
    const last = merged[merged.length - 1];
    if (last && n.low <= last.high) {
      last.high = Math.max(last.high, n.high);
      last.vol = Math.max(last.vol, n.vol);
      last.share = Math.max(last.share, n.share);
      if (n.vol > last.vol) last.price = n.price;
    } else {
      merged.push({ ...n });
    }
  }
  return merged.sort((a, b) => b.vol - a.vol);
}

/** LVN = đáy cục bộ share ≤ 0.8% nằm TRONG range đã trade (không tính hai rìa). */
export function findLVN(bins: VPBin[]): Node[] {
  const out: Node[] = [];
  // rìa profile luôn mỏng — bỏ qua 5% mỗi đầu để không gọi rìa là LVN
  const pad = Math.max(1, Math.floor(bins.length * 0.05));
  for (let i = pad; i < bins.length - pad; i++) {
    const b = bins[i];
    if (b.share > LVN_SHARE) continue;
    if (b.vol > bins[i - 1].vol || b.vol > bins[i + 1].vol) continue;
    out.push({ price: b.mid, low: b.low, high: b.high, vol: b.vol, share: b.share });
  }
  out.sort((a, b) => a.low - b.low);
  const merged: Node[] = [];
  for (const n of out) {
    const last = merged[merged.length - 1];
    if (last && n.low <= last.high + 1e-12) {
      last.high = Math.max(last.high, n.high);
      last.vol += n.vol;
      last.share += n.share;
      last.price = (last.low + last.high) / 2;
    } else merged.push({ ...n });
  }
  return merged;
}

/** Delta cộng dồn của các bin nằm trong [low, high]. */
export function deltaInRange(vp: VolumeProfile, low: number, high: number): number {
  let d = 0;
  for (const b of vp.bins) if (b.mid >= low && b.mid <= high) d += b.delta;
  return d;
}

/**
 * HVN gần nhất theo hướng dir (1 = lên, -1 = xuống) tính từ giá `from`.
 * So bằng BIÊN GẦN của node, không phải đỉnh: một node ôm lấy `from` thì
 * không phải "node phía trên" hay "node phía dưới" — nó là node đang chứa giá.
 */
export function nextHVN(vp: VolumeProfile, from: number, dir: 1 | -1): Node | null {
  const cands = vp.hvn
    .filter((n) => (dir === 1 ? n.low > from : n.high < from))
    .sort((a, b) => (dir === 1 ? a.low - b.low : b.high - a.high));
  return cands[0] ?? null;
}

/** Node đang CHỨA giá — đứng trong thân node là đứng giữa nhà, không phải mép. */
export function nodeContaining(vp: VolumeProfile, price: number): Node | null {
  return vp.hvn.find((n) => price >= n.low && price <= n.high) ?? null;
}

/** Đếm số HVN mà một lệnh phải xuyên để đi từ `from` tới `to`. Chống TP nhảy cóc. */
export function hvnCrossings(vp: VolumeProfile, from: number, to: number): number {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return vp.hvn.filter((n) => n.price > lo && n.price < hi).length;
}

export function inValueArea(vp: VolumeProfile, price: number): boolean {
  return price >= vp.va70.low && price <= vp.va70.high;
}

/** true khi giá nằm ở lõi VA (25–75% bề rộng) — vùng CẤM vào lệnh. */
export function inMidValue(vp: VolumeProfile, price: number): boolean {
  const w = vp.va70.high - vp.va70.low;
  if (w <= 0) return false;
  const pos = (price - vp.va70.low) / w;
  return pos > 0.25 && pos < 0.75;
}

function fmt(x: number): string {
  return x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toFixed(6);
}
