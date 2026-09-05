// ============================================================
// Schema trung tâm. Mọi module phân tích đều nói bằng ngôn ngữ này.
// ============================================================

export type TF = '15m' | '1h' | '4h' | '1d';
export const TFS: TF[] = ['15m', '1h', '4h', '1d'];

export type Bias = 'LONG' | 'SHORT' | 'WAIT';

/** Vị trí của giá so với cấu trúc value — quyết định có được phép vào hay không. */
export type Stage =
  | 'edge-fail'   // chạm mép trên rồi đóng ngược xuống → short setup
  | 'edge-hold'   // giữ mép dưới rồi đóng xanh → long setup
  | 'breakdown'   // đóng thủng LVN/VAL, chấp nhận giá dưới
  | 'breakout'    // đóng vượt LVN/VAH, chấp nhận giá trên
  | 'mid-range';  // giữa VA / quanh POC → cấm vào

export type SizeHint = 'Small' | 'Normal';

/** Nguồn của một con số phái sinh. UNAVAILABLE = N/A, không được dùng làm lý do. */
export type DataQuality = 'REAL' | 'PROXY' | 'UNAVAILABLE';

export interface Candle {
  t: number;   // open time ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;   // base volume
  q: number;   // quote volume
  takerBuyBase: number | null;  // null nếu venue không公 bố
  closed: boolean;
}

// ---------- Volume Profile ----------

export type VPMode = 'close' | 'range';

export interface VPBin {
  /** Giá thấp nhất của bin. */
  low: number;
  /** Giá cao nhất của bin. */
  high: number;
  /** Giá giữa bin — số dùng để in ra. */
  mid: number;
  vol: number;
  /** Volume nến xanh trừ nến đỏ rơi vào bin này (close-direction delta). */
  delta: number;
  /** vol / tổng vol, 0–1. */
  share: number;
}

export interface ValueArea {
  low: number;
  high: number;
  /** Tỷ lệ volume nằm trong VA thực tế (≈ target). */
  coverage: number;
}

export interface Node {
  /** Đỉnh (HVN) hoặc đáy (LVN) của node. */
  price: number;
  /** Biên node — dùng để đặt SL ngoài cả cụm, không phải ngoài 1 bin. */
  low: number;
  high: number;
  vol: number;
  share: number;
}

export interface VolumeProfile {
  mode: VPMode;
  binSize: number;
  binCount: number;
  /** Cảnh báo khi bin bị nới vì range quá rộng (BTC). */
  binNote: string | null;
  bins: VPBin[];
  poc: number;
  va70: ValueArea;
  va80: ValueArea;
  hvn: Node[];
  lvn: Node[];
  totalVol: number;
  /** Tổng delta close-direction của cả profile. */
  delta: number;
  from: number;
  to: number;
  candles: number;
}

export interface CompositeProfiles {
  /** Từ 00:00 ICT hôm nay (hoặc từ mốc user đánh dấu). */
  session: VolumeProfile | null;
  h24: VolumeProfile | null;
  d3: VolumeProfile | null;
  /** "pullback" khi giá dưới POC 3D nhưng trên POC session. */
  dualRead: string | null;
}

// ---------- Price Action ----------

export interface Swing {
  index: number;
  price: number;
  type: 'H' | 'L';
}

export type StructureEvent = 'BOS_UP' | 'BOS_DOWN' | 'CHOCH_UP' | 'CHOCH_DOWN' | 'NONE';

export type CandleSignal =
  | 'pin-bull'
  | 'pin-bear'
  | 'engulf-bull'
  | 'engulf-bear'
  | 'inside'
  | 'none';

export interface PriceAction {
  swingHighs: Swing[];
  swingLows: Swing[];
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  structure: StructureEvent;
  /** Equal highs/lows = túi SL, đừng đặt stop ngay sau chúng. */
  equalHighs: number[];
  equalLows: number[];
  /** high/low 20 nến gần nhất. */
  range: { high: number; low: number };
  /** Vị trí close trong range 20 nến, 0–100. */
  rangePos: number;
  /** Tín hiệu nến ĐÃ ĐÓNG gần nhất, chỉ tính khi vol ≥ median 20. */
  signal: CandleSignal;
  signalHasVolume: boolean;
  /** true = close giữ ngoài range (accept). false = wick ra rồi đóng trong (grab). */
  acceptedOutside: 'up' | 'down' | null;
  grab: 'up' | 'down' | null;
  atr: number;
  volMedian20: number;
  lastVol: number;
  trendUp: boolean;
  trendDown: boolean;
}

// ---------- Phái sinh ----------

export interface FundingInfo {
  quality: DataQuality;
  venue: string | null;
  /** Funding rate hiện tại, đơn vị thập phân trên 8h (0.0001 = 0.01%). */
  rate: number | null;
  nextFundingTime: number | null;
  markPrice: number | null;
  /** |FR| < 0.02%/8h → phẳng → CẤM dùng làm lý do. */
  flat: boolean;
  extreme: boolean;
  note: string;
}

export type OIRead =
  | 'long-cover'    // OI ↓ giá ↓
  | 'new-longs'     // OI ↑ giá ↑
  | 'short-cover'   // OI ↓ giá ↑
  | 'new-shorts'    // OI ↑ giá ↓
  | 'flat'
  | 'na';

export interface OIInfo {
  quality: DataQuality;
  venue: string | null;
  open: number | null;         // OI hiện tại (USD notional nếu venue trả USD)
  unit: string | null;
  chg1h: number | null;        // %
  chg24h: number | null;       // %
  read: OIRead;
  /** OI/vol24h cao bất thường → cảnh báo squeeze, KHÔNG phải tín hiệu vào lệnh. */
  squeezeWarning: boolean;
  oiOverVol: number | null;
  note: string;
}

export interface DeltaInfo {
  quality: DataQuality;   // REAL = taker thật (spot), PROXY = close-direction
  /** Chợ mà taker delta này thuộc về. Không bao giờ trộn spot với perp. */
  venue: 'binance-spot' | 'proxy' | null;
  /** Delta của cây đã đóng gần nhất. */
  lastBar: number | null;
  /** CVD cộng dồn trên cửa sổ. */
  cvd: number | null;
  cvdSeries: number[];
  /** Delta theo bin giá — ưu tiên hơn CVD thời gian. */
  deltaAtPrice: { price: number; delta: number }[];
  divergence: 'regular-bull' | 'regular-bear' | 'none';
  note: string;
}

export interface Derivatives {
  funding: FundingInfo;
  oi: OIInfo;
  /** Taker perp. Khi fapi 451 → UNAVAILABLE. */
  perpTaker: DeltaInfo;
}

// ---------- Chấm điểm ----------

export interface ScoreLine {
  label: string;
  points: number;   // âm = trừ
}

export interface Confluence {
  score: number;         // 0–10, đã clamp
  raw: number;
  lines: ScoreLine[];
}

// ---------- Khuyến nghị ----------

export interface Recommendation {
  symbol: string;
  tf: TF;
  bias: Bias;
  stage: Stage;
  /** 2 mức entry. null khi WAIT không có kèo chờ. */
  entry: [number, number] | null;
  trigger: string;
  sl: number | null;
  /** BẮT BUỘC nằm trong VA / tại POC. */
  tp1: number | null;
  tp2: number | null;
  /** Chỉ mở sau khi đóng thủng sàn/trần HTF. */
  runner: string | null;
  rr1: number | null;
  rr2: number | null;
  size: SizeHint;
  invalidation: string;
  reasons: string[];       // 3–6 gạch
  confidence: number;      // 1–10
  confluence: Confluence;
  warnings: string[];
  /** TF vào lệnh ngược TF lớn. */
  counterTrend: boolean;
  /** Số liệu để UI vẽ VP mini. */
  vp: {
    poc: number;
    vaLow: number;
    vaHigh: number;
    last: number;
    binSize: number;
    hvn: number[];
    lvn: number[];
  };
  rangePos: number;
  planText: string;
}

export interface SymbolScan {
  symbol: string;
  ts: number;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  rangePos: number;
  tfs: Record<TF, Recommendation>;
  derivatives: Derivatives;
  spotTakerDelta: DeltaInfo;
  /** Bản điện luôn-ra-hướng. Kiểu cụ thể: DirectionalCall / MarketStructure / FlowInfo. */
  direction: Record<TF, unknown>;
  structure: Record<TF, unknown>;
  flow: unknown;
  composite: {
    sessionPoc: number | null;
    h24Poc: number | null;
    d3Poc: number | null;
    dualRead: string | null;
  };
  errors: string[];
}

export interface ScanSnapshot {
  ts: number;
  ictTime: string;
  symbols: SymbolScan[];
  sources: { spot: string; perp: string; okx: string };
  degraded: string[];
}
