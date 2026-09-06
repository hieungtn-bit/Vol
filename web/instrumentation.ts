/**
 * Next gọi hàm này một lần khi tiến trình server khởi động — chỗ đúng để bật
 * quét nền, vì nó chạy độc lập với mọi request và mọi trình duyệt.
 *
 * `NEXT_RUNTIME === 'nodejs'` là bắt buộc: bản edge không có setTimeout sống lâu,
 * không có đĩa, không có node:sqlite. Gọi vào đó là nổ lúc build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startScanner, scannerState } = await import('@/lib/scanner');
  startScanner();
  const s = scannerState();
  if (s.running) {
    console.log(`[quét nền] bật · ${s.symbols.length} mã · lượt kế tiếp ${new Date(s.nextRunAt!).toISOString()}`);
  } else {
    console.log(`[quét nền] KHÔNG bật — ${s.why}`);
  }
}
