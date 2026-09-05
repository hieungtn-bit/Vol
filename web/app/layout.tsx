import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Market Scan · Multi-TF',
  description: 'Quét thị trường crypto và ra khuyến nghị theo 15m / 1h / 4h / 1D bằng Price Action + Volume Profile + OI + Funding.',
  // Thêm được vào màn hình chính như một app, và không hiện thanh địa chỉ đè lên
  // thanh trên dính.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Market Scan' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // KHÔNG khoá zoom. Một bảng số dày đặc mà cấm phóng to là chặn đường người mắt
  // kém — và chặn cả người muốn soi kỹ một mức giá.
  maximumScale: 5,
  userScalable: true,
  themeColor: '#0b0e13',
  // Cho phép nội dung tràn xuống vùng tai thỏ; các lớp safe-* lo phần đệm.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
