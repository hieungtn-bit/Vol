import { describe, expect, it } from 'vitest';
import { buildComposite } from '@/lib/scan';
import type { Candle } from '@/lib/types';

/** Chuỗi nến 15m kết thúc ở hiện tại, dài `bars` nến. */
function k15(bars: number): Candle[] {
  const step = 15 * 60_000;
  const end = Math.floor(Date.now() / step) * step;
  const out: Candle[] = [];
  for (let i = bars; i >= 1; i--) {
    const t = end - i * step;
    const p = 100 + Math.sin(i / 9) * 2;
    out.push({
      t, o: p, h: p + 0.3, l: p - 0.3, c: p,
      v: 100, q: 100 * p, takerBuyBase: 50, closed: true,
    });
  }
  return out;
}

describe('composite profile chỉ dựng cửa sổ mà dữ liệu thật sự phủ hết', () => {
  it('192 nến (đúng 2.00 ngày) thì KHÔNG có profile 3D', () => {
    const c = buildComposite(k15(192), 100, 0.5);
    expect(c.session).toBeTruthy();
    expect(c.h24).toBeTruthy();
    expect(c.d3).toBeNull();
    // và phải nói ra, chứ không im lặng
    expect(c.dualRead).toMatch(/Chưa đủ 3 ngày/);
  });

  it('320 nến (3.3 ngày — đúng lượng scan.ts tải) thì CÓ profile 3D', () => {
    const c = buildComposite(k15(320), 100, 0.5);
    expect(c.d3).toBeTruthy();
    expect(c.dualRead).toMatch(/POC 3D/);
    expect(c.dualRead).not.toMatch(/Chưa đủ/);
  });

  it('câu "dưới/trên POC 3D" chỉ xuất hiện khi thật sự có POC 3D', () => {
    for (const bars of [100, 192, 240, 287]) {
      const c = buildComposite(k15(bars), 100, 0.5);
      if (c.d3 === null) {
        expect(c.dualRead ?? '').not.toMatch(/(dưới|trên) (cả )?POC 3D/);
      }
    }
  });

  it('nến chưa đóng không được tính vào profile', () => {
    const cs = k15(320);
    const open = { ...cs[cs.length - 1], closed: false, h: 9999, l: 9999 };
    const withOpen = buildComposite([...cs.slice(0, -1), open], 100, 0.5);
    const closedOnly = buildComposite(cs.slice(0, -1), 100, 0.5);
    expect(withOpen.d3?.poc).toBe(closedOnly.d3?.poc);
  });
});
