// App sống ở GỐC domain (scan.maix8.study). Trước đây nó chạy dưới /scan để nấp sau
// rewrite của maix8.study; từ khi có subdomain riêng thì basePath chỉ tổ đẻ ra
// scan.maix8.study/scan/. Vẫn để override được bằng env cho ai muốn gắn lại vào
// một path con.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Chỉ bật khi thật sự phục vụ dưới một path con; rỗng thì Next tự bỏ qua.
  basePath: basePath || undefined,

  // Giữ trailingSlash để mọi đường dẫn có đúng một dạng chuẩn, và để apiPath()
  // (vốn thêm dấu / cuối) không dính 308 thừa ở mỗi lần gọi API.
  trailingSlash: true,

  // Cho phép instrumentation.ts chạy lúc khởi động server — chỗ bật quét nền.
  experimental: { instrumentationHook: true },

  /**
   * `node:sqlite`, `node:fs`, `node:zlib`… là module dựng sẵn của Node, không phải
   * gói trong node_modules. Webpack cố đọc chúng như file và chết ngay lúc build.
   *
   * Vì sao phải làm cả cho bản EDGE chứ không chỉ bản Node: instrumentation.ts
   * được biên dịch cho cả hai runtime, nên webpack vẫn đi theo nhánh import của
   * nó dù lúc chạy có `NEXT_RUNTIME !== 'nodejs'` chặn ngay đầu hàm. Đánh dấu
   * external là bảo webpack đừng đọc, không phải bảo Node đừng chặn.
   *
   * Chỉ áp cho bản server. Bản trình duyệt mà đụng tới được `node:` thì đó là
   * lỗi khác hẳn — nghĩa là CSDL đang bị kéo vào client bundle — và lúc đó phải
   * để nó nổ lúc build chứ không phải giấu đi.
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals ?? []),
        ({ request }, cb) =>
          request?.startsWith('node:') ? cb(null, `commonjs ${request}`) : cb(),
      ];
    }
    return config;
  },

  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  logging: { fetches: { fullUrl: false } },
};
export default nextConfig;
