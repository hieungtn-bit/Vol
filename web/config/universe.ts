// ============================================================
// Cấu hình universe. Sửa file này, không sửa code engine.
// ============================================================

/**
 * Luôn có mặt trong watchlist dù volume không đạt ngưỡng.
 * PAXGUSDT là vàng token hoá (1 PAXG = 1 troy ounce vàng vật chất) — cách duy nhất
 * đọc vàng bằng đúng engine này, vì toàn bộ dữ liệu đến từ Binance. Thanh khoản mỏng
 * hơn crypto nhiều và phái sinh có thể không có; chỗ nào thiếu thì hệ ghi N/A.
 */
export const ALWAYS_INCLUDE = ['BTCUSDT', 'ETHUSDT', 'ENAUSDT', 'PAXGUSDT'];

/** Ngưỡng quote volume 24h mặc định (USD). */
export const DEFAULT_MIN_QUOTE_VOL = 5_000_000;

/** Số symbol tối đa mỗi lần scan — giữ để không đấm exchange. */
export const MAX_SCAN_SYMBOLS = 40;

/** Leverage token: *UP/*DOWN/*BULL/*BEAR — loại thẳng. */
export const LEVERAGE_TOKEN_RE = /(UP|DOWN|BULL|BEAR)USDT$/;

/** Stable/stable và các cặp không có ý nghĩa TA. */
export const EXCLUDE_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'EUR', 'GBP', 'AEUR', 'USD1', 'RLUSD', 'PYUSD',
]);

/**
 * Wrapped equity / tokenized stock. Mặc định LOẠI.
 * Bật lại bằng query `?equity=1` nếu bạn thực sự muốn.
 */
export const EQUITY_BASES = new Set([
  'TSLA', 'AAPL', 'NVDA', 'MSTR', 'COIN', 'GOOGL', 'AMZN', 'META', 'MSFT',
]);

export interface UniverseFilter {
  minQuoteVol: number;
  includeEquity: boolean;
  extraSymbols: string[];
}

export const DEFAULT_FILTER: UniverseFilter = {
  minQuoteVol: DEFAULT_MIN_QUOTE_VOL,
  includeEquity: false,
  extraSymbols: [],
};

export function isEligible(symbol: string, quoteVol: number, f: UniverseFilter): boolean {
  if (!symbol.endsWith('USDT')) return false;
  if (LEVERAGE_TOKEN_RE.test(symbol)) return false;
  const base = symbol.slice(0, -4);
  if (EXCLUDE_BASES.has(base)) return false;
  if (!f.includeEquity && EQUITY_BASES.has(base)) return false;
  return quoteVol >= f.minQuoteVol;
}
