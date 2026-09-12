import { describe, expect, it } from 'vitest';
import { decideBias, noEdgeReason, type DecideInput } from '@/lib/decide';
import { analyzePriceAction } from '@/lib/priceAction';
import { buildDelta } from '@/lib/derivatives';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import type { Candle } from '@/lib/types';

/** `n` nến quanh `base`; `tail` nến cuối trôi đi `drift` để giá ra hẳn ngoài value. */
function series(base: number, n: number, drift = 0, tail = 0): Candle[] {
  const out: Candle[] = [];
  const start = Date.now() - (n + 2) * 3_600_000;
  for (let i = 0; i < n; i++) {
    const away = i >= n - tail ? drift * ((i - (n - tail) + 1) / Math.max(1, tail)) : 0;
    const p = base + Math.sin(i / 6) * (base * 0.004) + away;
    out.push({
      t: start + i * 3_600_000, o: p, h: p * 1.002, l: p * 0.998, c: p,
      v: 100, q: 100 * p, takerBuyBase: 50, closed: true,
    });
  }
  return out;
}

function inp(candles: Candle[]): DecideInput {
  const closed = candles.filter((c) => c.closed);
  const vp = computeVolumeProfile(closed, { mode: 'close' })!;
  return {
    symbol: 'T', tf: '1h', candles, vp,
    pa: analyzePriceAction(candles),
    delta: buildDelta(candles, vp, 'binance-spot'),
    deriv: { funding: {} as never, oi: {} as never, perpTaker: {} as never },
    htf: null, hasClosedBar: true, last: closed[closed.length - 1].c,
  };
}

describe('nhãn phải nói đúng cái nào là cái nào', () => {
  it('giá RỜI HẲN khỏi value không được hiện là "đứng GIỮA value"', () => {
    // Lỗi thật trên production: BNB 15m giá 721.49 với VA 744–759.5, tức DƯỚI VA
    // 1.45 lần bề rộng VA, mà màn hình ghi "đứng GIỮA value area" — ngay cạnh
    // câu "giá đã rời hẳn xuống dưới value".
    //
    // Trạng thái cần dựng là "đã rời hẳn và đứng yên ở xa", KHÔNG phải một cú
    // rơi vừa được chấp nhận — cú rơi đó là `breakdown`, một stage có kèo hẳn
    // hoi. Nên phải tắt `acceptedOutside`, đúng như khi giá đã ra ngoài từ lâu
    // và range 20 nến gần nhất đã dời theo.
    const base = inp(series(100, 160, -14, 30));
    const i: DecideInput = { ...base, pa: { ...base.pa, acceptedOutside: null } };

    const pos = (i.last - i.vp.va70.low) / (i.vp.va70.high - i.vp.va70.low);
    expect(pos).toBeLessThan(0);
    expect(noEdgeReason(i.vp, i.pa, i.last)).toBe('roi-khoi-value');

    const nhan = decideBias(i).confluence.lines.map((l) => l.label).join(' ');
    expect(nhan).toMatch(/rời hẳn khỏi value/);
    expect(nhan).not.toMatch(/đứng GIỮA value/);
  });

  it('giá đứng giữa value thì vẫn nói đúng là đứng giữa', () => {
    const i = inp(series(100, 160));
    if (noEdgeReason(i.vp, i.pa, i.last) === 'giua-value') {
      expect(decideBias(i).confluence.lines.map((l) => l.label).join(' ')).toMatch(/đứng GIỮA value/);
    }
  });

  it('noEdgeReason phân biệt được hai tình huống ngược nhau', () => {
    const ngoai = inp(series(100, 160, -14, 30));
    const trong = inp(series(100, 160));
    expect(noEdgeReason(ngoai.vp, ngoai.pa, ngoai.last)).toBe('roi-khoi-value');
    expect(noEdgeReason(trong.vp, trong.pa, trong.last)).not.toBe('roi-khoi-value');
  });

  it('nhãn không bao giờ mâu thuẫn với chính lý do in ngay bên cạnh', () => {
    // Đây là dạng tổng quát của lỗi: hai câu nói ngược nhau trên cùng màn hình.
    for (const cs of [series(100, 160), series(100, 160, -14, 30), series(100, 160, 14, 30)]) {
      const rec = decideBias(inp(cs));
      const nhan = rec.confluence.lines.map((l) => l.label).join(' ');
      const lyDo = rec.reasons.join(' ');
      if (/đứng GIỮA value/.test(nhan)) expect(lyDo).not.toMatch(/rời hẳn/);
      if (/rời hẳn khỏi value/.test(nhan)) expect(lyDo).not.toMatch(/đứng giữa value/);
    }
  });
});
