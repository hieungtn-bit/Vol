import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0e13',
        panel: '#131820',
        panel2: '#1a212c',
        line: '#242c38',
        muted: '#8b97a8',
        long: '#16a34a',
        short: '#dc2626',
        wait: '#64748b',
        warn: '#f59e0b',
      },
      fontSize: {
        // 0.66rem ≈ 10.5px là dưới ngưỡng đọc thoải mái trên điện thoại, và
        // dấu tiếng Việt còn cần thêm chiều cao dòng. Nâng lên 11px/16px.
        '2xs': ['0.6875rem', '1rem'],
      },
      minHeight: { tap: '44px' },
      screens: {
        // Điểm gãy riêng cho "đủ rộng để bảng dense có nghĩa".
        board: '900px',
      },
    },
  },
  plugins: [],
};
export default config;
