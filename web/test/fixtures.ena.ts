import type { Candle } from '@/lib/types';

// ============================================================
// Số THẬT của phiên ENAUSDT 05/09/2026 (giờ ICT) và BTCUSDT 1d.
// Không chỉnh cho đẹp. Nếu máy không đọc đúng những cây này thì máy sai,
// không phải fixture sai.
// ============================================================

const H = 3_600_000;

/** 00:00 ICT ngày 05/09/2026 quy về mốc UTC ms. */
export const ICT0 = Date.UTC(2026, 8, 4, 17, 0, 0);   // 05/09 00:00 ICT = 04/09 17:00Z

export const ictHour = (day: 4 | 5, hour: number) =>
  ICT0 + (day === 4 ? -24 : 0) * H + hour * H;

interface Bar { d: 4 | 5; h: number; o: number; hi: number; lo: number; c: number; v: number; tbRatio?: number }

/**
 * Các cây 1 giờ ĐÃ ĐÓNG của phiên. Volume triệu ENA.
 * `tbRatio` = tỷ lệ taker mua, dùng để dựng delta đúng dấu đã ghi trong đề bài.
 */
const ENA_1H: Bar[] = [
  // Cây event 19:00 ngày 4/9 — vol 728 triệu, thủng hẳn cụm cũ 0.1687–0.1710
  { d: 4, h: 19, o: 0.16967, hi: 0.17065, lo: 0.15530, c: 0.16450, v: 728, tbRatio: 0.34 },
  { d: 4, h: 20, o: 0.16450, hi: 0.16560, lo: 0.16180, c: 0.16290, v: 96, tbRatio: 0.47 },
  { d: 4, h: 21, o: 0.16290, hi: 0.16420, lo: 0.16150, c: 0.16330, v: 74, tbRatio: 0.51 },
  { d: 4, h: 22, o: 0.16330, hi: 0.16440, lo: 0.16210, c: 0.16280, v: 61, tbRatio: 0.48 },
  { d: 4, h: 23, o: 0.16280, hi: 0.16390, lo: 0.16137, c: 0.16210, v: 58, tbRatio: 0.46 },
  { d: 5, h: 0, o: 0.16210, hi: 0.16350, lo: 0.16132, c: 0.16300, v: 52, tbRatio: 0.52 },
  { d: 5, h: 1, o: 0.16300, hi: 0.16410, lo: 0.16240, c: 0.16360, v: 44, tbRatio: 0.53 },
  { d: 5, h: 2, o: 0.16360, hi: 0.16450, lo: 0.16280, c: 0.16330, v: 41, tbRatio: 0.49 },
  { d: 5, h: 3, o: 0.16330, hi: 0.16420, lo: 0.16260, c: 0.16380, v: 38, tbRatio: 0.51 },
  { d: 5, h: 4, o: 0.16380, hi: 0.16470, lo: 0.16300, c: 0.16400, v: 36, tbRatio: 0.52 },
  { d: 5, h: 5, o: 0.16400, hi: 0.16490, lo: 0.16330, c: 0.16420, v: 34, tbRatio: 0.51 },
  { d: 5, h: 6, o: 0.16420, hi: 0.16520, lo: 0.16350, c: 0.16460, v: 39, tbRatio: 0.53 },
  { d: 5, h: 7, o: 0.16460, hi: 0.16560, lo: 0.16390, c: 0.16480, v: 42, tbRatio: 0.52 },
  { d: 5, h: 8, o: 0.16480, hi: 0.16570, lo: 0.16400, c: 0.16440, v: 40, tbRatio: 0.49 },
  { d: 5, h: 9, o: 0.16440, hi: 0.16530, lo: 0.16370, c: 0.16490, v: 37, tbRatio: 0.52 },
  { d: 5, h: 10, o: 0.16490, hi: 0.16580, lo: 0.16420, c: 0.16510, v: 43, tbRatio: 0.53 },
  { d: 5, h: 11, o: 0.16510, hi: 0.16600, lo: 0.16450, c: 0.16530, v: 45, tbRatio: 0.53 },
  { d: 5, h: 12, o: 0.16530, hi: 0.16620, lo: 0.16470, c: 0.16550, v: 46, tbRatio: 0.53 },
  // 13:00 — thử VAH, vol 48, delta +7.5
  { d: 5, h: 13, o: 0.16550, hi: 0.16637, lo: 0.16500, c: 0.16570, v: 48, tbRatio: 0.578 },
  // 14:00 — từ chối 0.16637, vol 46
  { d: 5, h: 14, o: 0.16570, hi: 0.16637, lo: 0.16400, c: 0.16439, v: 46, tbRatio: 0.46 },
  { d: 5, h: 15, o: 0.16439, hi: 0.16466, lo: 0.16262, c: 0.16374, v: 40, tbRatio: 0.48 },
  { d: 5, h: 16, o: 0.16374, hi: 0.16438, lo: 0.16307, c: 0.16345, v: 27, tbRatio: 0.49 },
  { d: 5, h: 17, o: 0.16345, hi: 0.16424, lo: 0.16320, c: 0.16372, v: 25, tbRatio: 0.51 },
  { d: 5, h: 18, o: 0.16372, hi: 0.16520, lo: 0.16340, c: 0.16490, v: 44, tbRatio: 0.54 },
  // 19:00 — lên mép, vol 85.6, delta +0.1 (mua chủ động KHÔNG thắng)
  { d: 5, h: 19, o: 0.16490, hi: 0.16589, lo: 0.16450, c: 0.16563, v: 85.6, tbRatio: 0.5006 },
  // 20:00 — từ chối 0.16589, vol 67.2, delta −9.9
  { d: 5, h: 20, o: 0.16563, hi: 0.16589, lo: 0.16330, c: 0.16361, v: 67.2, tbRatio: 0.4263 },
];

function bar(b: Bar): Candle {
  const t = ictHour(b.d, b.h);
  const v = b.v * 1e6;
  const tb = v * (b.tbRatio ?? 0.5);
  return { t, o: b.o, h: b.hi, l: b.lo, c: b.c, v, q: v * b.c, takerBuyBase: tb, closed: true };
}

export const ena1h = (): Candle[] => ENA_1H.map(bar);

/**
 * 15m dựng từ 1h: mỗi cây 1h tách thành bốn cây 15m nối tiếp nhau, giữ nguyên
 * open/close hai đầu và phân bổ đều volume. Không phải dữ liệu thật ở mức 15m,
 * nhưng đủ để kiểm chứng CÁCH CHIA LỚP và CÁCH ĐO — hai thứ đang hỏng.
 */
export function ena15m(): Candle[] {
  const out: Candle[] = [];
  for (const b of ENA_1H) {
    const t0 = ictHour(b.d, b.h);
    const v = (b.v * 1e6) / 4;
    const path = [b.o, b.o + (b.c - b.o) * 0.34, b.o + (b.c - b.o) * 0.67, b.c];
    for (let i = 0; i < 4; i++) {
      const o = i === 0 ? b.o : path[i - 1];
      const c = path[i];
      const hi = i === 1 ? b.hi : Math.max(o, c);
      const lo = i === 2 ? b.lo : Math.min(o, c);
      out.push({
        t: t0 + i * 900_000, o, h: hi, l: lo, c, v,
        q: v * c, takerBuyBase: v * (b.tbRatio ?? 0.5), closed: true,
      });
    }
  }
  return out;
}

/** Cụm cũ đã bị bỏ lại sau cây event, theo đề bài. */
export const ENA_OLD_CLUSTER: [number, number] = [0.1687, 0.1710];
/** Cụm mới hình thành sau event. */
export const ENA_NEW_CLUSTER: [number, number] = [0.1613, 0.1664];
/** POC phiên. */
export const ENA_SESSION_POC: [number, number] = [0.162, 0.163];

// ------------------------------------------------------------
// BTCUSDT 1d: giá ~79700 trong khi vùng giá trị CŨ là 59500–67000.
// ------------------------------------------------------------

/**
 * 120 nến ngày: 80 cây tích luỹ trong 59500–67000, rồi bứt lên và tích luỹ lại
 * quanh 79000–80000. Đây là cấu hình "đã chấp nhận NGOÀI vùng, phía trên" —
 * không có cách đọc nào biến nó thành "đang ở giữa vùng giá trị".
 */
export function btc1d(): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2026, 4, 1);
  const day = 86_400_000;
  const push = (o: number, h: number, l: number, c: number, v: number) => {
    out.push({ t, o, h, l, c, v, q: v * c, takerBuyBase: v * 0.5, closed: true });
    t += day;
  };
  for (let i = 0; i < 80; i++) {
    const mid = 59500 + ((i * 977) % 7500);
    push(mid, mid + 900, mid - 900, mid, 2200);
  }
  // Bứt lên: đi qua vùng mỏng 67000–76000 bằng vài cây mạnh, volume vừa phải
  for (const c of [69500, 72500, 75500, 78000]) push(c - 1800, c + 700, c - 2000, c, 900);
  // Tích luỹ mới quanh 79000–80000
  for (let i = 0; i < 36; i++) {
    const mid = 79000 + ((i * 311) % 1000);
    push(mid, mid + 350, mid - 350, mid, 2000);
  }
  return out;
}

export const BTC_OLD_VA: [number, number] = [59500, 67000];
