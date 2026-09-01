// Base path đặt một chỗ duy nhất rồi bơm xuống client qua `env`, để code gọi API
// và cấu hình build không bao giờ lệch nhau. Đặt NEXT_PUBLIC_BASE_PATH="" để chạy
// ở gốc domain (ví dụ khi test trên URL *.vercel.app của chính project này).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/scan';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // App được phục vụ dưới maix8.study/scan qua rewrite của project writetoearn.
  // Không có basePath thì mọi asset sẽ đi xin /_next/... ở gốc domain — nơi site
  // tĩnh MAIX8 Research đang ở — và trang lên trắng.
  basePath: basePath || undefined,

  // Phải khớp `trailingSlash: true` của vercel.json bên writetoearn. Lệch nhau thì
  // hai bên đá redirect qua lại: outer thêm dấu /, Next gỡ dấu / → vòng lặp 308.
  trailingSlash: true,

  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  logging: { fetches: { fullUrl: false } },
};
export default nextConfig;
