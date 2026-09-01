import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Market Scan · Multi-TF',
  description: 'Quét thị trường crypto và ra khuyến nghị theo 15m / 1h / 4h / 1D bằng Price Action + Volume Profile + OI + Funding.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
