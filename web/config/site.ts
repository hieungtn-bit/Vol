/**
 * Base path lúc chạy, do next.config.mjs bơm xuống qua `env`.
 * Client fetch KHÔNG được Next tự thêm basePath (basePath chỉ áp cho next/link,
 * router và asset), nên mọi lời gọi API phải tự ghép tiền tố này.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Ghép đường dẫn API kèm dấu / cuối cho khớp trailingSlash — tránh 308 thừa mỗi call. */
export function apiPath(path: string, query?: Record<string, string>): string {
  const q = query ? `?${new URLSearchParams(query)}` : '';
  return `${BASE_PATH}/api/${path}/${q}`;
}
