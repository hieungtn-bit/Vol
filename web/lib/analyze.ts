import { decideBias, type DecideInput, type HTFContext } from './decide';
import { decideDirection, type DirectionalCall } from './direct';
import { buildDelta } from './derivatives';
import { analyzePriceAction, atr } from './priceAction';
import { analyzeStructure, type MarketStructure } from './structure';
import { computeVolumeProfile } from './volumeProfile';
import type { Candle, Derivatives, Recommendation, TF } from './types';
import type { FlowInfo } from './flow';

// ============================================================
// Chỗ DUY NHẤT dựng đầu vào phân tích từ một chuỗi nến.
//
// Quét live và backtest đều đi qua đây. Nếu backtest tự dựng lấy input theo
// cách riêng thì nó kiểm chứng một hệ khác với hệ đang chạy thật, và mọi con số
// nó in ra đều vô nghĩa.
//
// Hàm này KHÔNG gọi mạng và KHÔNG đọc đồng hồ. Mọi thứ phụ thuộc thời gian
// (nến nào đã đóng, "bây giờ" là lúc nào) phải do phía gọi truyền vào — đó là
// điều kiện để backtest không nhìn trộm tương lai.
// ============================================================

export const MIN_BARS = 30;

export interface PreparedTF {
  input: DecideInput;
  structure: MarketStructure;
}

export interface PrepareOpts {
  symbol: string;
  tf: TF;
  /** Toàn bộ nến tới thời điểm đang xét. Nến chưa đóng (nếu có) phải nằm cuối. */
  candles: Candle[];
  deriv: Derivatives;
  htf: HTFContext | null;
  /** TF này đã có nến đóng thuộc chu kỳ vừa xong chưa. */
  hasClosedBar: boolean;
}

/** Trả về null khi không đủ dữ liệu — phía gọi tự quyết định báo lỗi thế nào. */
export function prepareTF(o: PrepareOpts): PreparedTF | null {
  const closed = o.candles.filter((c) => c.closed);
  if (closed.length < MIN_BARS) return null;

  const a = atr(closed);
  const vp = computeVolumeProfile(closed, { mode: 'close', atr: a });
  if (!vp) return null;

  const pa = analyzePriceAction(o.candles);
  const delta = buildDelta(o.candles, vp, 'binance-spot');

  return {
    input: {
      symbol: o.symbol,
      tf: o.tf,
      candles: o.candles,
      vp, pa, delta,
      deriv: o.deriv,
      htf: o.htf,
      hasClosedBar: o.hasClosedBar,
      last: closed[closed.length - 1].c,
    },
    structure: analyzeStructure(o.candles),
  };
}

/** Chạy cả hai đường kết luận trên cùng một bộ đầu vào. */
export function decideBoth(
  p: PreparedTF,
  flow: FlowInfo,
): { strict: Recommendation; directional: DirectionalCall } {
  return {
    strict: decideBias(p.input),
    directional: decideDirection(p.input, p.structure, flow),
  };
}
