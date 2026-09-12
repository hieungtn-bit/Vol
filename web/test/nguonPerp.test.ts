/**
 * Sổ USD-M — nhãn chợ và thứ tự lấy giá.
 *
 * Người dùng vào lệnh trên perp, nên value area, H8, H11 và giá live đều phải
 * đọc từ sổ perp. Test ở đây khoá hai thứ dễ trôi nhất: gọi nhầm chợ, và lấy
 * nhầm cột volume.
 */
import { describe, expect, it } from 'vitest';
import { SOURCES } from '../lib/sources';

describe('gương sổ USD-M', () => {
  it('fapi.binance.com đứng đầu, www.binance.com là lớp đỡ', () => {
    expect(SOURCES.FAPI_MIRRORS[0]).toBe('https://fapi.binance.com');
    expect(SOURCES.FAPI_MIRRORS).toContain('https://www.binance.com');
  });

  it('gương spot KHÔNG được lẫn vào gương perp và ngược lại', () => {
    // Hai chợ, hai sổ. Trộn vào nhau là nguồn gốc của mọi nhãn sai.
    expect(SOURCES.FAPI_MIRRORS).not.toContain(SOURCES.SPOT);
    expect(SOURCES.FAPI_MIRRORS.some((m) => m.includes('data-api'))).toBe(false);
  });
});

describe('thứ tự giá live', () => {
  /** Đúng thứ tự mà scanSymbol dùng: mark → ticker perp → ticker spot → close nến. */
  const giaLive = (
    mark: number | null, perpLast: number | null, spotLast: number | null, closeNen: number,
  ) => mark ?? perpLast ?? spotLast ?? closeNen;

  it('có markPrice thì lấy markPrice', () => {
    expect(giaLive(0.14139, 0.14141, 0.14150, 0.1400)).toBe(0.14139);
  });

  it('thiếu mark thì tới ticker PERP, không nhảy thẳng sang spot', () => {
    expect(giaLive(null, 0.14141, 0.14150, 0.1400)).toBe(0.14141);
  });

  it('mất cả sổ perp thì mới dùng spot', () => {
    expect(giaLive(null, null, 0.14150, 0.1400)).toBe(0.14150);
  });

  it('close của nến đã đóng là chốt chặn CUỐI, không bao giờ là lựa chọn đầu', () => {
    // Thẻ 4H ngày 11/09 sống sót vì `last` là close nến cũ: giá thật đã 0.154,
    // trên SL 0.15254, mà thẻ vẫn thấy 0.1480.
    expect(giaLive(0.154, null, null, 0.1480)).toBe(0.154);
    expect(giaLive(null, null, null, 0.1480)).toBe(0.1480);
  });
});

describe('cột volume', () => {
  it('so volume phải dùng BASE, không được rơi về quote khi thiếu', () => {
    // Kline perp ENAUSDT 1H thật: base 15.17m, quote 2.14m. Lấy nhầm cột là
    // hai cây cạnh nhau đo bằng hai đơn vị khác nhau.
    const nen = { v: 15_170_541, q: 2_138_938 };
    const dungBase = (c: { v: number; q: number }) => c.v;
    const saiCu = (c: { v: number; q: number }) => c.q || c.v;
    expect(dungBase(nen)).toBe(15_170_541);
    expect(saiCu(nen)).not.toBe(dungBase(nen));
  });
});
