/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Route handlers hit exchange REST APIs at request time.
  logging: { fetches: { fullUrl: false } },
};
export default nextConfig;
