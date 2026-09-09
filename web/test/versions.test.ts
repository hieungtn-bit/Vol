import { describe, expect, it } from 'vitest';
import { V1, V2, V_CONTROL, weightTotal } from '@/lib/versions';
import { DEFAULT_LEVELS } from '@/lib/decide';
import { ROUND_TRIP } from '@/lib/fees';
import { W } from '@/lib/direct';

describe('các phiên bản phải so được với nhau', () => {
  it('TỔNG trọng số bằng nhau ở mọi bản — nếu không thì hạng đổi nghĩa', () => {
    // Ngưỡng hạng (|net| ≥ 30 = A, ≥ 15 = B) so trên thang tuyệt đối. Đổi tổng
    // là đổi luôn ý nghĩa của hạng, và mọi so sánh thành vô nghĩa.
    const t = weightTotal(W);
    expect(weightTotal(V1.weights)).toBe(t);
    expect(weightTotal(V2.weights)).toBe(t);
    expect(weightTotal(V_CONTROL.weights)).toBe(t);
  });

  it('v1 đúng bằng bản đang chạy — mốc so sánh không được lệch', () => {
    expect(V1.weights).toEqual(W);
    expect(V1.levels).toEqual(DEFAULT_LEVELS);
    expect(V1.levels.costFloorMult).toBe(0);
  });

  it('v2 bỏ hẳn funding, và chỉ funding', () => {
    expect(V2.weights.funding).toBe(0);
    // Các vế đo ra nhiễu nhưng DƯƠNG thì giảm chứ không bỏ — bỏ sạch là quả
    // quyết hơn mức bằng chứng cho phép.
    expect(V2.weights.openInterest).toBeGreaterThan(0);
    expect(V2.weights.priceAction).toBeGreaterThan(0);
    expect(V2.weights.valueLocation).toBeGreaterThan(0);
  });

  it('v2 dồn trọng số về đúng hai vế đo ra có edge', () => {
    expect(V2.weights.structure).toBeGreaterThan(W.structure);
    expect(V2.weights.takerFlow).toBeGreaterThan(W.takerFlow);
    // và chúng phải chiếm đa số
    expect(V2.weights.structure + V2.weights.takerFlow).toBeGreaterThan(weightTotal(V2.weights) / 2);
  });

  it('đối chứng ngược đúng là NGƯỢC: bỏ sạch hai vế có bằng chứng', () => {
    expect(V_CONTROL.weights.structure).toBe(0);
    expect(V_CONTROL.weights.takerFlow).toBe(0);
    expect(V_CONTROL.weights.funding).toBeGreaterThan(0);
  });

  it('sàn chi phí của v2 là 2 vòng phí, và v1 không có sàn nào', () => {
    expect(V2.levels.costFloorMult).toBe(2);
    expect(V1.levels.costFloorMult).toBe(0);
    // 2 vòng phí trên giá 100 = 0.24 — mục tiêu gần hơn thế là không thể có lãi
    expect(100 * ROUND_TRIP * 2).toBeCloseTo(0.24, 6);
  });
});
