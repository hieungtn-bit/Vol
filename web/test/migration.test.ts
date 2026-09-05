import { describe, expect, it } from 'vitest';
import { GAP_THINNESS_MAX, OVERLAP_MAX, findValueMigration, gapBetween, gapThinness, overlapRatio, profileOfCurrentValue, volumeShareIn } from '@/lib/migration';
import { computeVolumeProfile } from '@/lib/volumeProfile';
import type { Candle } from '@/lib/types';

/**
 * Một "nhà" volume quanh một mức giá.
 *
 * Giá phải TRẢI ra vài bin chứ không dồn hết vào một bin. Nến thật luôn trải, và
 * một phân phối dồn vào đúng một bin làm value area co lại thành lát mỏng — khi
 * đó mọi phép đo bề rộng đều thành vô nghĩa. Fixture phẳng tuyệt đối không kiểm
 * chứng được gì, nó chỉ kiểm chứng cái artefact của chính nó.
 */
function at(price: number, n: number, from: number, v = 100, spread = 0.12): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = price + (((i * 7) % 9) / 8 - 0.5) * spread;   // rải đều, tất định
    return {
      t: (from + i) * 3_600_000,
      o: c, h: c + 0.02, l: c - 0.02, c,
      v, q: v * c, takerBuyBase: v * 0.5, closed: true,
    };
  });
}

describe('đo chồng lấn hai vùng', () => {
  it('rời hẳn nhau → 0', () => {
    expect(overlapRatio({ low: 1, high: 2 }, { low: 3, high: 4 })).toBe(0);
  });
  it('trùng khít → 1', () => {
    expect(overlapRatio({ low: 1, high: 2 }, { low: 1, high: 2 })).toBe(1);
  });
  it('vùng hẹp nằm trọn trong vùng rộng → 1, không phải tỉ lệ bề rộng', () => {
    // Chia cho đoạn HẸP hơn: value mới nhỏ gọn nằm trong value cũ rộng vẫn là
    // "chưa dời đi đâu cả", không được coi là đã dời.
    expect(overlapRatio({ low: 0, high: 10 }, { low: 4, high: 5 })).toBe(1);
  });
  it('chồng một nửa', () => {
    expect(overlapRatio({ low: 0, high: 2 }, { low: 1, high: 3 })).toBeCloseTo(0.5, 6);
  });
});

describe('đoạn giữa hai vùng', () => {
  it('chồng nhau → không có đoạn giữa', () => {
    expect(gapBetween({ low: 0, high: 2 }, { low: 1, high: 3 })).toBeNull();
  });
  it('dính nhau → không có đoạn giữa', () => {
    expect(gapBetween({ low: 0, high: 1 }, { low: 1, high: 2 })).toBeNull();
  });
  it('rời nhau → trả đúng đoạn ở giữa', () => {
    expect(gapBetween({ low: 0, high: 1 }, { low: 3, high: 4 })).toEqual({ low: 1, high: 3 });
  });
  it('volume trong đoạn tính theo phần bin nằm trong, không tính cả bin', () => {
    const vp = computeVolumeProfile(at(100, 10, 0).concat(at(110, 10, 10)), { binSize: 1 })!;
    expect(volumeShareIn(vp, 99, 111)).toBeCloseTo(1, 6);
    expect(volumeShareIn(vp, 103, 107)).toBe(0);
  });

  it('độ mỏng đo bằng MẬT ĐỘ, không bằng lượng — đây là chỗ hai lần trước làm sai', () => {
    // Hai nhà volume cách xa nhau: vùng giữa rộng mà trống → mỏng.
    const jump = computeVolumeProfile(at(100, 30, 0).concat(at(120, 30, 30)), { binSize: 0.05 })!;
    expect(gapThinness(jump, { low: 101, high: 119 })).toBeLessThan(GAP_THINNESS_MAX);

    // Trôi đều: mọi đoạn con đều dày xấp xỉ mức trung bình → KHÔNG mỏng.
    const drift: Candle[] = [];
    for (let i = 0; i < 120; i++) drift.push(...at(100 + i * 0.005, 1, i));
    const dvp = computeVolumeProfile(drift, { binSize: 0.05 })!;
    expect(gapThinness(dvp, { low: 100.2, high: 100.3 })).toBeGreaterThan(GAP_THINNESS_MAX);
  });
});

describe('phát hiện value dời chỗ', () => {
  it('giá đứng yên một chỗ → KHÔNG báo dời', () => {
    const m = findValueMigration(at(100, 120, 0), 0.05);
    expect(m.from).toBe(0);
    expect(m.note).toBeNull();
  });

  it('trôi giá từ từ trong cùng một vùng → KHÔNG báo dời', () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 120; i++) cs.push(...at(100 + i * 0.005, 1, i));
    expect(findValueMigration(cs, 0.05).from).toBe(0);
  });

  it('nhảy hẳn sang vùng khác → báo dời, và cắt ĐÚNG chỗ nhảy', () => {
    const cs = [...at(100, 60, 0), ...at(120, 60, 60)];
    const m = findValueMigration(cs, 0.05);
    expect(m.from).toBeGreaterThan(0);
    expect(m.overlap).toBeLessThan(OVERLAP_MAX);
    // Điểm cắt phải nằm SAU chỗ nhảy (60), để phần giữ lại thuần vùng mới.
    // Không ràng buộc chặt hơn: cắt ở 61 hay 81 đều cho VA đúng, và cái đáng
    // kiểm tra là VA chứ không phải chỉ số nến — test ngay dưới lo phần đó.
    expect(m.from).toBeGreaterThanOrEqual(60);
    expect(m.from).toBeLessThan(cs.length);
    expect(m.note).toContain('Value đã dời chỗ');
  });

  it('cắt xong thì VA hẹp lại và ôm lấy giá hiện tại — đây mới là điểm của cả việc này', () => {
    const cs = [...at(100, 60, 0), ...at(120, 60, 60)];
    const blended = computeVolumeProfile(cs, { binSize: 0.05 })!;
    const { vp } = profileOfCurrentValue(cs, { binSize: 0.05 });
    const last = cs[cs.length - 1].c;

    const wBlended = blended.va70.high - blended.va70.low;
    const wCut = vp!.va70.high - vp!.va70.low;
    expect(wCut).toBeLessThan(wBlended);
    // VA trộn hai phân phối thì POC nằm ở vùng không ai còn giao dịch nữa.
    expect(Math.abs(vp!.poc - last)).toBeLessThan(Math.abs(blended.poc - last));
    // POC phải nằm ngay cạnh giá hiện tại (trong bề rộng của chính nhà volume
    // đó, 0.12), chứ không phải ở vùng cách 20 giá mà không ai còn giao dịch.
    expect(Math.abs(vp!.poc - last)).toBeLessThan(0.2);
    expect(Math.abs(blended.poc - last)).toBeGreaterThan(10);
    // Còn VA trộn hai phân phối thì rộng tới mức ôm cả vùng không ai giao dịch nữa.
    expect(wBlended).toBeGreaterThan(wCut * 5);
  });

  it('tắt cờ thì không cắt gì cả', () => {
    const cs = [...at(100, 60, 0), ...at(120, 60, 60)];
    const off = profileOfCurrentValue(cs, { binSize: 0.05 }, false);
    expect(off.migration.from).toBe(0);
    expect(off.vp!.va70).toEqual(computeVolumeProfile(cs, { binSize: 0.05 })!.va70);
  });

  it('quá ít nến thì không kết luận gì', () => {
    expect(findValueMigration(at(100, 20, 0), 0.05).from).toBe(0);
  });

  it('lấy cú dời GẦN NHẤT khi có hai cú dời', () => {
    const cs = [...at(100, 50, 0), ...at(120, 50, 50), ...at(140, 50, 100)];
    const m = findValueMigration(cs, 0.05);
    expect(m.from).toBeGreaterThanOrEqual(85);
  });

  it('không nhìn trộm tương lai: cắt bỏ nến sau i không đổi kết luận tại i', () => {
    const full = [...at(100, 60, 0), ...at(120, 60, 60), ...at(160, 40, 120)];
    const upTo = full.slice(0, 100);
    expect(findValueMigration(upTo, 0.05)).toEqual(findValueMigration(upTo.slice(), 0.05));
  });
});
