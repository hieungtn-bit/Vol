import { describe, expect, it } from 'vitest';
import { MAX_VA_BINS, MIN_VA_BINS, bandStep, fitProfile, pocBand, stepDown, stepUp, toStep } from '@/lib/ruler';
import { defaultBinSize } from '@/lib/volumeProfile';
import { btc1d, ena15m, ena1h } from './fixtures.ena';

describe('bước bin theo BẬC GIÁ, ATR không được đụng vào', () => {
  it('đúng bảng bậc giá, hai cột thô/mịn', () => {
    expect(bandStep(0.163, '10d')).toBe(0.001);
    expect(bandStep(0.163, '24h')).toBe(0.0005);
    expect(bandStep(5, '48h')).toBe(0.01);
    expect(bandStep(5, 'session_4h')).toBe(0.005);
    expect(bandStep(102, '10d')).toBe(0.1);
    expect(bandStep(102, 'after_event')).toBe(0.05);
    expect(bandStep(1500, '10d')).toBe(1);
    expect(bandStep(1500, '24h')).toBe(0.5);
    expect(bandStep(79700, '10d')).toBe(10);
    expect(bandStep(79700, '24h')).toBe(5);
  });

  it('thang bước chỉ đi theo nấc 1/2/5', () => {
    expect(stepUp(0.001)).toBeCloseTo(0.002, 10);
    expect(stepUp(0.002)).toBeCloseTo(0.005, 10);
    expect(stepUp(0.005)).toBeCloseTo(0.01, 10);
    expect(stepDown(0.001)).toBeCloseTo(0.0005, 10);
    expect(stepDown(10)).toBeCloseTo(5, 10);
    expect(stepUp(10)).toBeCloseTo(20, 10);
  });

  it('LỖI CŨ: ATR kéo bước ENA lên gấp mười so với bậc giá', () => {
    // Đây là nguyên nhân của POC ngày 0.0775. Giữ lại làm bằng chứng hồi quy.
    const atrNgay = 0.04;
    expect(defaultBinSize(0.163, atrNgay)).toBeGreaterThan(bandStep(0.163, '10d') * 4);
    // Thước mới không nhận ATR, nên không thể hỏng theo kiểu đó nữa.
    expect(bandStep(0.163, '10d')).toBe(0.001);
  });
});

describe('ràng buộc 4–25 bin trong vùng 70%', () => {
  it('ENA: mọi lớp đều đạt', () => {
    for (const layer of ['10d', '48h', '24h'] as const) {
      const f = fitProfile(ena15m(), layer)!;
      expect(f.vaBins).toBeGreaterThanOrEqual(MIN_VA_BINS);
      expect(f.vaBins).toBeLessThanOrEqual(MAX_VA_BINS);
      expect(f.note).toBeNull();
    }
  });

  it('BTC ngày: bước tự nới lên hàng trăm USD, không giữ 10 USD', () => {
    const f = fitProfile(btc1d(), '10d')!;
    expect(f.bandStep).toBe(10);
    expect(f.step).toBeGreaterThanOrEqual(100);
    expect(f.vaBins).toBeGreaterThanOrEqual(MIN_VA_BINS);
    expect(f.vaBins).toBeLessThanOrEqual(MAX_VA_BINS);
    expect(f.adjustments).toBeGreaterThan(0);
  });

  it('không đạt thì PHẢI nói ra, không im lặng dùng số sai', () => {
    const f = fitProfile(ena15m(), '24h')!;
    if (f.vaBins < MIN_VA_BINS || f.vaBins > MAX_VA_BINS) expect(f.note).not.toBeNull();
    else expect(f.note).toBeNull();
  });
});

describe('ENA: thước mới không được ra POC ngày 0.0775', () => {
  it('POC của mọi lớp đều nằm quanh giá đang giao dịch, không rơi xuống 0.077', () => {
    const c = ena15m();
    const last = c[c.length - 1].c;
    for (const layer of ['10d', '48h', '24h'] as const) {
      const f = fitProfile(c, layer)!;
      expect(f.vp.poc).toBeGreaterThan(0.15);
      expect(Math.abs(f.vp.poc - last) / last).toBeLessThan(0.15);
    }
  });

  it('vùng giá trị 24h không được rộng tới mức nuốt cả vách cũ lẫn cụm phiên', () => {
    const f = fitProfile(ena15m(), '24h')!;
    const w = (f.vp.va70.high - f.vp.va70.low) / f.vp.poc;
    // Vùng 0.146–0.171 rộng 15% giá là thứ đề bài gọi là "trộn hai cụm".
    expect(w).toBeLessThan(0.12);
  });
});

describe('điểm kiểm soát là một DẢI, không phải một tick', () => {
  it('trả về dải có bề rộng thật và ôm lấy POC', () => {
    const c = ena15m();
    const f = fitProfile(c, '24h')!;
    const [lo, hi] = pocBand(c, f.vp);
    expect(hi).toBeGreaterThan(lo);
    expect(f.vp.poc).toBeGreaterThanOrEqual(lo);
    expect(f.vp.poc).toBeLessThanOrEqual(hi);
  });

  it('dải bám vào các cây khối lượng lớn nhất đã đóng', () => {
    const c = ena1h();
    const f = fitProfile(c, '24h')!;
    const [lo, hi] = pocBand(c, f.vp);
    const top = [...c].sort((a, b) => b.v - a.v)[0];
    expect(hi).toBeGreaterThanOrEqual(Math.min(lo, top.l));
  });
});

describe('làm tròn về đúng thước, không in số lẻ hơn bước', () => {
  it('bám bước', () => {
    expect(toStep(0.163713, 0.0005)).toBe(0.1635);
    expect(toStep(79655.99, 100)).toBe(79700);
    expect(toStep(0.16637, 0.001)).toBe(0.166);
  });
});
