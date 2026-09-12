/**
 * Lớp cache — chỗ quyết định trang trắng hay trang còn số khi sàn chặn.
 *
 * Ngày 12/09 production trả `price: 0` và bốn thẻ WAIT vì Binance đáp 418.
 * Nến 40 giây trước vẫn còn trong RAM và vẫn dùng được, nhưng cache cũ không có
 * đường lấy nó ra. Các test dưới đây khoá đúng hành vi đó.
 */
import { describe, expect, it, vi } from 'vitest';
import { cached, cachedCoTuoi, KhongCoDuLieu } from '../lib/cache';

const key = () => `k-${Math.random().toString(36).slice(2)}`;

describe('cache giữ bản tốt cuối cùng', () => {
  it('nguồn chết sau khi đã có bản tốt → trả bản cũ, và NÓI là cũ', async () => {
    const k = key();
    await cached(k, 1, async () => 'tot');
    await vi.waitFor(() => new Promise((r) => setTimeout(r, 5)));

    const r = await cachedCoTuoi(k, 1, async () => { throw new Error('HTTP 418'); });
    expect(r.value).toBe('tot');
    expect(r.cu).toBe(true);
    expect(r.tuoiMs).toBeGreaterThan(0);
  });

  it('chưa từng có bản tốt thì NÉM, không trả rỗng giả vờ là dữ liệu', async () => {
    await expect(cachedCoTuoi(key(), 1, async () => { throw new Error('HTTP 418'); }))
      .rejects.toBeInstanceOf(KhongCoDuLieu);
  });

  it('bản mới đè bản cũ và tuổi về lại 0', async () => {
    const k = key();
    await cached(k, 1, async () => 'cu');
    await new Promise((r) => setTimeout(r, 5));
    const r = await cachedCoTuoi(k, 1, async () => 'moi');
    expect(r.value).toBe('moi');
    expect(r.cu).toBe(false);
    expect(r.tuoiMs).toBe(0);
  });

  it('còn trong TTL thì không gọi nguồn lần nữa', async () => {
    const k = key();
    let goi = 0;
    const f = async () => { goi++; return 'x'; };
    await cached(k, 10_000, f);
    await cached(k, 10_000, f);
    expect(goi).toBe(1);
  });

  it('nhiều lời gọi trùng key cùng lúc chỉ bắn MỘT request', async () => {
    const k = key();
    let goi = 0;
    const f = async () => { goi++; await new Promise((r) => setTimeout(r, 10)); return 'x'; };
    await Promise.all([cached(k, 10_000, f), cached(k, 10_000, f), cached(k, 10_000, f)]);
    expect(goi).toBe(1);
  });

  it('lỗi KHÔNG được ghi vào cache như một giá trị tốt', async () => {
    const k = key();
    await expect(cached(k, 10_000, async () => { throw new Error('hỏng'); })).rejects.toThrow();
    // Lần sau nguồn sống lại thì phải lấy được số thật, không dính bản lỗi.
    expect(await cached(k, 10_000, async () => 'that')).toBe('that');
  });
});
