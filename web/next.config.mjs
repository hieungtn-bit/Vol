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

  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  logging: { fetches: { fullUrl: false } },
};
export default nextConfig;
