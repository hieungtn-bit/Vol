// Cache in-memory theo TTL. Mục đích duy nhất: không spam exchange.
type Entry = { at: number; ttl: number; value: unknown };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export const DEFAULT_TTL = Number(process.env.CACHE_TTL_MS ?? 20_000);

export async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < hit.ttl) return hit.value as T;

  // Gộp các request trùng key đang bay — 30 symbol × 4 TF không được nhân 4 lần call.
  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;

  const p = fn()
    .then((v) => {
      store.set(key, { at: Date.now(), ttl, value: v });
      return v;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p as Promise<T>;
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size };
}
