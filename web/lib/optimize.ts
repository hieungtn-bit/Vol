import { FEES, type Conviction } from './direct';
import { stats, type BTStats, type Trade } from './backtest';

// ============================================================
// TỐI ƯU CÓ KIỂM CHỨNG — walk-forward
//
// Vấn đề của cách làm cũ: mọi ngưỡng trong hệ (hạng ≥ B, R kỳ vọng ≤ 1.5, phí
// ≤ 10% của 1R) đều do người nhìn BẢNG HIỆU CHUẨN TRÊN TOÀN BỘ MẪU rồi chọn.
// Sau đó lại lấy chính nửa sau của mẫu đó ra gọi là "ngoài mẫu". Nhưng nửa sau
// ĐÃ tham gia vào việc chọn ngưỡng, nên con số ấy lạc quan hơn thực tế. Đây là
// rò rỉ dữ liệu, dạng tinh vi và rất dễ tự lừa mình.
//
// Cách làm đúng: chia thời gian thành nhiều đoạn. Với mỗi đoạn, CHỌN ngưỡng chỉ
// bằng dữ liệu TRƯỚC nó, rồi chấm điểm trên đúng đoạn đó và không bao giờ nhìn
// lại. Ghép các đoạn lại được một đường vốn mà tại mọi thời điểm, tham số dùng
// để giao dịch đều đã có sẵn từ trước — tức là thứ thật sự chạy được.
// ============================================================

const RANK: Record<Conviction, number> = { C: 0, B: 1, A: 2, GOLD: 3 };

/** Bộ luật CHỌN LỆNH. Chỉ quyết định nhận hay bỏ, không đổi hướng, không đổi mức giá. */
export interface Gate {
  minConviction: Conviction;
  unanimousOnly: boolean;
  maxRRBlended: number | null;
  minRRBlended: number | null;
  /** Phí quy ra R không được vượt mức này. null = không lọc. */
  maxFeeShare: number | null;
  minNet: number | null;
}

/**
 * Phí quy ra R, tính từ ĐỘ RỘNG STOP.
 *
 * KHÔNG được dùng `t.costR`: trường đó cộng thêm trượt giá chỉ khi lệnh thoát
 * bằng stop, tức nó phụ thuộc vào KẾT QUẢ. Lọc bằng nó là nhìn trộm tương lai —
 * bộ lọc sẽ tự động ưu ái những lệnh không dính stop, và mọi con số sau đó đều
 * vô nghĩa. `slPct` thì biết được ngay lúc ra tín hiệu.
 */
export function feeShareOf(t: Trade): number {
  if (!(t.slPct > 0)) return Infinity;
  return (FEES.perSide * 2 + FEES.slip) / (t.slPct / 100);
}

export function passes(t: Trade, g: Gate): boolean {
  if (RANK[t.conviction] < RANK[g.minConviction]) return false;
  if (g.unanimousOnly && !t.unanimous) return false;
  if (g.maxRRBlended != null && (t.rrBlended ?? 0) > g.maxRRBlended) return false;
  if (g.minRRBlended != null && (t.rrBlended ?? 0) < g.minRRBlended) return false;
  if (g.maxFeeShare != null && feeShareOf(t) > g.maxFeeShare) return false;
  if (g.minNet != null && Math.abs(t.net) < g.minNet) return false;
  return true;
}

export function applyGate(trades: Trade[], g: Gate): Trade[] {
  return trades.filter((t) => passes(t, g));
}

export function gateLabel(g: Gate): string {
  const p: string[] = [`≥${g.minConviction}`];
  if (g.unanimousOnly) p.push('nhất trí');
  if (g.minNet != null) p.push(`net≥${g.minNet}`);
  if (g.minRRBlended != null) p.push(`Rkv≥${g.minRRBlended}`);
  if (g.maxRRBlended != null) p.push(`Rkv≤${g.maxRRBlended}`);
  if (g.maxFeeShare != null) p.push(`phí≤${(g.maxFeeShare * 100).toFixed(0)}%`);
  return p.join(' + ');
}

/**
 * Điểm để so hai bộ luật với nhau.
 *
 * KHÔNG dùng avgR trần: một bộ luật chỉ nhận 3 lệnh may mắn sẽ luôn thắng. Dùng
 * dạng thống kê t = avgR × √n, tức thưởng cho edge lớn NHƯNG cũng thưởng cho
 * việc edge đó được đo trên nhiều lệnh. Kèm một sàn số lệnh để loại hẳn những
 * bộ luật không đủ dữ liệu để nói gì.
 */
export function score(t: Trade[], minTrades: number): number {
  if (t.length < minTrades) return -Infinity;
  const s = stats(t);
  return s.avgR * Math.sqrt(t.length);
}

/** Sinh toàn bộ không gian tham số cần thử. */
export function gateSpace(): Gate[] {
  const out: Gate[] = [];
  for (const minConviction of ['C', 'B', 'A'] as Conviction[]) {
    for (const unanimousOnly of [false, true]) {
      for (const maxRRBlended of [null, 1.0, 1.5, 2.0]) {
        for (const minRRBlended of [null, 0.5]) {
          for (const maxFeeShare of [null, 0.06, 0.08, 0.1, 0.15, 0.2]) {
            for (const minNet of [null, 10, 20, 30]) {
              out.push({ minConviction, unanimousOnly, maxRRBlended, minRRBlended, maxFeeShare, minNet });
            }
          }
        }
      }
    }
  }
  return out;
}

export interface FoldResult {
  fold: number;
  trainN: number;
  testFrom: string;
  testTo: string;
  chosen: Gate;
  /** Kết quả trên đoạn test — tham số CHƯA từng nhìn thấy đoạn này. */
  test: BTStats;
  /** Cùng đoạn test nhưng dùng bộ luật cố định đang chạy thật, để so. */
  baseline: BTStats;
}

export interface WalkForward {
  folds: FoldResult[];
  /** Ghép mọi lệnh của mọi đoạn test lại — đường vốn thật sự chạy được. */
  combined: BTStats;
  combinedBaseline: BTStats;
  /** Số lần bộ luật được chọn lại khác với lần trước. Đổi liên tục = không ổn định. */
  switches: number;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Chạy walk-forward.
 *
 * Chia mẫu thành `folds + 1` đoạn theo thời gian. Đoạn đầu chỉ dùng để huấn
 * luyện. Từ đoạn thứ hai trở đi: chọn bộ luật bằng TẤT CẢ dữ liệu trước đoạn đó,
 * rồi chấm trên đoạn đó.
 */
export function walkForward(
  all: Trade[],
  opt: { folds?: number; minTrades?: number; space?: Gate[]; baseline: Gate },
): WalkForward {
  const folds = opt.folds ?? 4;
  const minTrades = opt.minTrades ?? 60;
  const space = opt.space ?? gateSpace();

  const sorted = [...all].sort((a, b) => a.signalTime - b.signalTime);
  const size = Math.floor(sorted.length / (folds + 1));
  const results: FoldResult[] = [];
  const testTrades: Trade[] = [];
  const testBaseline: Trade[] = [];
  let switches = 0;
  let prev: string | null = null;

  for (let k = 1; k <= folds; k++) {
    const cut = size * k;
    const end = k === folds ? sorted.length : size * (k + 1);
    const train = sorted.slice(0, cut);
    const test = sorted.slice(cut, end);
    if (!test.length) continue;

    // Chọn bộ luật CHỈ bằng train.
    let best: Gate | null = null;
    let bestScore = -Infinity;
    for (const g of space) {
      const s = score(applyGate(train, g), minTrades);
      if (s > bestScore) { bestScore = s; best = g; }
    }
    if (!best) continue;

    const label = gateLabel(best);
    if (prev != null && label !== prev) switches++;
    prev = label;

    const kept = applyGate(test, best);
    const base = applyGate(test, opt.baseline);
    testTrades.push(...kept);
    testBaseline.push(...base);

    results.push({
      fold: k,
      trainN: train.length,
      testFrom: day(test[0].signalTime),
      testTo: day(test[test.length - 1].signalTime),
      chosen: best,
      test: stats(kept),
      baseline: stats(base),
    });
  }

  return {
    folds: results,
    combined: stats(testTrades),
    combinedBaseline: stats(testBaseline),
    switches,
  };
}

/**
 * Độ NHẠY của một ngưỡng: giữ nguyên mọi thứ khác, quét một chiều.
 *
 * Một ngưỡng tốt phải nằm trên một CAO NGUYÊN, không phải trên một đỉnh nhọn.
 * Đỉnh nhọn nghĩa là kết quả phụ thuộc vào việc chọn đúng con số đó, tức gần như
 * chắc chắn là uốn theo nhiễu.
 */
export function sensitivity<K extends keyof Gate>(
  trades: Trade[],
  base: Gate,
  key: K,
  values: Gate[K][],
): { value: Gate[K]; n: number; avgR: number; pf: number }[] {
  return values.map((v) => {
    const s = stats(applyGate(trades, { ...base, [key]: v }));
    return { value: v, n: s.trades, avgR: s.avgR, pf: s.profitFactor };
  });
}
