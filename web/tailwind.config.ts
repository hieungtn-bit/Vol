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
        '2xs': ['0.66rem', '0.9rem'],
      },
    },
  },
  plugins: [],
};
export default config;
