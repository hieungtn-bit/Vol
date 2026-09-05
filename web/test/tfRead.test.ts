import { describe, expect, it } from 'vitest';
import { readTF } from '@/lib/tfRead';
import { buildLayers } from '@/lib/layers';
import { btc1d, ena15m, ena1h, ictHour } from './fixtures.ena';
import type { OIInfo, TF } from '@/lib/types';

const NOW = ictHour(5, 21);
const oiNA: OIInfo = {
  quality: 'UNAVAILABLE', venue: null, open: null, unit: null,
  chg1h: null, chg24h: null, read: 'na', squeezeWarning: false, oiOverVol: null, note: 'N/A',
};

const readEna = (tf: TF) => readTF({
  tf, candles: ena1h(), layers: buildLayers(ena15m(), ena1h(), NOW),
  last4hClosed: null, spotPerpAgree: false, fundingPoints: 0, oi: oiNA,
})!;

describe('ENAUSDT chiều–tối 05/09 — kỳ vọng của đề bài', () => {
  const r = readEna('1h');

  it('1h: đứng ngoài, còn trong vùng', () => {
    expect(r.state).toBe('trong_vung');
    expect(r.bias).toBe('dung_ngoai');
  });

  it('KHÔNG in mức giá khi đứng ngoài — lỗi #5 đã chặn', () => {
    expect(r.plan).toBeNull();
    expect(r.gate.pass).toBe(false);
    expect(r.gate.fail_reasons.length).toBeGreaterThan(0);
  });

  it('vẫn in mép cần đóng để xem lại', () => {
    expect(r.watch).toContain('đóng ngoài');
    expect(r.watch.length).toBeGreaterThan(20);
  });

  it('vùng đang dùng nằm quanh 0.162–0.166, không phải 0.146–0.171', () => {
    expect(r.val).toBeGreaterThan(0.158);
    expect(r.vah).toBeLessThan(0.170);
  });

  it('KHÔNG có POC ngày 0.0775 ở bất kỳ khung nào', () => {
    for (const tf of ['15m', '1h', '4h', '1d'] as TF[]) {
      const x = readTF({
        tf, candles: ena1h(), layers: buildLayers(ena15m(), ena1h(), NOW),
        last4hClosed: null, spotPerpAgree: false, fundingPoints: 0, oi: oiNA,
      });
      if (!x) continue;
      expect(x.poc[0]).toBeGreaterThan(0.15);
      expect(x.poc[1]).toBeGreaterThan(0.15);
    }
  });

  it('lớp đặt lệnh không bao giờ là 10 ngày / 48 giờ', () => {
    expect(['24h', 'after_event', 'session_4h']).toContain(r.layer);
  });

  it('điểm kiểm soát là DẢI, không phải một tick', () => {
    expect(r.poc[1]).toBeGreaterThan(r.poc[0]);
  });

  it('khung 1 ngày không bao giờ có kế hoạch', () => {
    const d = readEna('1d');
    expect(d.plan).toBeNull();
    expect(d.gate.fail_reasons.join(' ')).toContain('không vào lệnh');
  });

  it('khung 4 giờ chỉ lọc, không tự phát lệnh', () => {
    const h4 = readEna('4h');
    expect(h4.plan).toBeNull();
  });

  it('một khung một trạng thái, chữ khớp số', () => {
    for (const tf of ['15m', '1h', '4h', '1d'] as TF[]) {
      const x = readEna(tf);
      expect(['trong_vung', 'chap_nhan_ngoai', 'vung_dich']).toContain(x.state);
      if (x.state === 'trong_vung') {
        expect(x.state_text.toLowerCase()).toContain('còn trong vùng');
        expect(x.state_text.toLowerCase()).not.toContain('chấp nhận ngoài');
      }
    }
  });

  it('schema đủ trường theo hợp đồng API', () => {
    for (const k of ['tf', 'state', 'bias', 'layer', 'poc', 'vah', 'val', 'hvn', 'lvn',
      'vol_candles', 'delta_div', 'score', 'gate', 'plan']) {
      expect(r).toHaveProperty(k);
    }
    expect(Array.isArray(r.vol_candles)).toBe(true);
    expect(r.vol_candles.length).toBeGreaterThan(0);
  });
});

describe('BTCUSDT 1d — ảnh chụp trạng thái', () => {
  it('giá ~79700 so với vùng cũ 59500–67000: chấp nhận ngoài vùng, KHÔNG phải giữa value', () => {
    const c = btc1d();
    const r = readTF({
      tf: '1d', candles: c,
      layers: buildLayers(c, c, c[c.length - 1].t + 86_400_000),
      last4hClosed: null, spotPerpAgree: false, fundingPoints: 0, oi: oiNA,
    })!;
    expect(r.state).toBe('chap_nhan_ngoai');
    expect(r.state_text.toLowerCase()).toContain('chấp nhận ngoài vùng');
    expect(r.state_text.toLowerCase()).not.toContain('còn trong vùng');
    expect(r.plan).toBeNull();          // 1d không bao giờ vào lệnh
  });
});

describe('chữ phải khớp số — điểm kiểm soát luôn nằm trong vùng giá trị', () => {
  it('mọi khung của ENA', () => {
    for (const tf of ['15m', '1h', '4h', '1d'] as TF[]) {
      const r = readEna(tf);
      expect(r.poc[0]).toBeGreaterThanOrEqual(r.val - 1e-9);
      expect(r.poc[1]).toBeLessThanOrEqual(r.vah + 1e-9);
      expect(r.poc[1]).toBeGreaterThan(r.poc[0]);
    }
  });

  it('BTC 1d có tách cụm: điểm kiểm soát phải là của CỤM CŨ, không phải profile trộn', () => {
    const c = btc1d();
    const r = readTF({
      tf: '1d', candles: c, layers: buildLayers(c, c, c[c.length - 1].t + 86_400_000),
      last4hClosed: null, spotPerpAgree: false, fundingPoints: 0, oi: oiNA,
    })!;
    expect(r.poc[0]).toBeGreaterThanOrEqual(r.val - 1e-9);
    expect(r.poc[1]).toBeLessThanOrEqual(r.vah + 1e-9);
    // Cụm cũ là 59500–67000, nên điểm kiểm soát phải nằm trong đó chứ không
    // được nhảy lên vùng 79000 của cụm mới.
    expect(r.poc[1]).toBeLessThan(70000);
  });

  it('bốn khung phải ĐỘC LẬP — không được cùng đọc một lớp', () => {
    const layers = buildLayers(ena15m(), ena1h(), NOW);
    const used = (['15m', '1h', '4h', '1d'] as TF[]).map((tf) => readTF({
      tf, candles: ena1h(), layers, last4hClosed: null,
      spotPerpAgree: false, fundingPoints: 0, oi: oiNA,
    })!.layer);
    expect(new Set(used).size).toBeGreaterThan(1);
  });
});
