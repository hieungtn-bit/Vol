/** Số chữ số thập phân suy từ bin size — in đúng độ mịn của profile, không thừa. */
export function decimalsFor(binSize: number): number {
  if (binSize >= 10) return 0;
  if (binSize >= 1) return 1;
  if (binSize >= 0.1) return 2;
  if (binSize >= 0.01) return 3;
  if (binSize >= 0.001) return 4;
  if (binSize >= 0.0001) return 5;
  return 6;
}

export function fmtPrice(x: number | null | undefined, binSize = 0.001): string {
  if (x == null || !isFinite(x)) return 'N/A';
  return x.toFixed(decimalsFor(binSize));
}

/**
 * Số chữ số thập phân hợp lý theo ĐỘ LỚN của giá, khi không biết bin size.
 *
 * UI trước gọi fmtPrice(price, 0.0001) cho mọi mã, nên BTC hiện ra
 * "79631.86000" — năm số lẻ trên một tài sản 79 nghìn đô. Ba chữ số cuối là
 * nhiễu thị giác thuần tuý, và trên màn hình điện thoại chúng đẩy cả cột giá
 * rộng ra vô ích.
 */
export function fmtTick(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return 'N/A';
  const a = Math.abs(x);
  const d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 6;
  return x.toFixed(d);
}

export function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !isFinite(x)) return 'N/A';
  return `${x >= 0 ? '+' : ''}${x.toFixed(digits)}%`;
}

export function fmtUsd(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return 'N/A';
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return x.toFixed(0);
}

export const ICT_OFFSET_MIN = 7 * 60;

export function ictString(ts = Date.now()): string {
  const d = new Date(ts + ICT_OFFSET_MIN * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ICT`;
}

/** Mốc 00:00 ICT của ngày hiện tại, tính bằng ms UTC. */
export function ictSessionStart(now = Date.now()): number {
  const shifted = now + ICT_OFFSET_MIN * 60_000;
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000;
  return dayStart - ICT_OFFSET_MIN * 60_000;
}
