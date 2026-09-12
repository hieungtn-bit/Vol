/**
 * Cache in-memory theo TTL. Hai mục đích, và mục đích thứ hai mới là thứ cứu
 * trang khi sàn chặn:
 *
 *   1. Không spam exchange.
 *   2. GIỮ GIÁ TRỊ TỐT CUỐI CÙNG. Một lần 418 không được phép biến cả trang
 *      thành trắng khi nến 40 giây trước vẫn dùng được — miễn là nói rõ số đó
 *      cũ bao nhiêu giây.
 */
type Entry = { at: number; ttl: number; value: unknown };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export const DEFAULT_TTL = Number(process.env.CACHE_TTL_MS ?? 20_000);

/**
 * Quá hạn TTL bao lâu thì vẫn còn dùng được khi nguồn chết. Mặc định 10 phút:
 * đủ để đi qua một đợt 418, và ngắn hơn nhiều so với khoảng thời gian mà nến
 * 15m/1h/4h còn nói đúng về thị trường.
 */
export const CUU_TTL = Number(process.env.CACHE_STALE_MS ?? 600_000);

export class KhongCoDuLieu extends Error {
  constructor(public readonly key: string, public readonly nguyenNhan: string) {
    super(nguyenNhan);
  }
}

export interface KetQuaCache<T> {
  value: T;
  /** Số ms giá trị này đã nằm trong cache. 0 = vừa lấy về. */
  tuoiMs: number;
  /** true = nguồn vừa chết, đây là bản cũ đang được dùng đỡ. */
  cu: boolean;
}

/** Bản có báo tuổi. Dùng khi phía gọi cần nói ra "số này cũ bao nhiêu". */
export async function cachedCoTuoi<T>(
  key: string, ttl: number, fn: () => Promise<T>,
): Promise<KetQuaCache<T>> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < hit.ttl) return { value: hit.value as T, tuoiMs: now - hit.at, cu: false };

  // Gộp các request trùng key đang bay — 30 symbol × 4 TF không được nhân 4 lần call.
  const flying = inflight.get(key);
  if (flying) return { value: (await flying) as T, tuoiMs: 0, cu: false };

  const p = fn()
    .then((v) => { store.set(key, { at: Date.now(), ttl, value: v }); return v; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);

  try {
    return { value: (await p) as T, tuoiMs: 0, cu: false };
  } catch (e) {
    // Nguồn chết. Còn bản cũ trong hạn cứu thì dùng, và NÓI RA là đang dùng bản cũ.
    const cuu = store.get(key);
    if (cuu && Date.now() - cuu.at < CUU_TTL) {
      return { value: cuu.value as T, tuoiMs: Date.now() - cuu.at, cu: true };
    }
    throw new KhongCoDuLieu(key, (e as Error).message);
  }
}

export async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  return (await cachedCoTuoi(key, ttl, fn)).value;
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size };
}
