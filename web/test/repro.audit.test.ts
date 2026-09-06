import { describe, expect, it } from 'vitest';
import { readTF } from '@/lib/tfRead';
import { buildLayers } from '@/lib/layers';
import { readState, edgeRejection } from '@/lib/vpState';
import { referenceLayer } from '@/lib/layers';
import type { Candle, OIInfo } from '@/lib/types';

const oiNA: OIInfo = {
  quality: 'UNAVAILABLE', venue: null, open: null, unit: null,
  chg1h: null, chg24h: null, read: 'na', squeezeWarning: false, oiOverVol: null, note: 'N/A',
};

const M15 = 900_000;
let T = Date.UTC(2026, 5, 1);
function bar(o: number, h: number, l: number, c: number, v: number, tb = 0.5): Candle {
  const b: Candle = { t: T, o, h, l, c, v, q: v * c, takerBuyBase: v * tb, closed: true };
  T += M15;
  return b;
}

/**
 * Kịch bản có Ý NGHĨA GIAO DỊCH, không phải mock điểm.
 *
 * Xây một cụm giá trị dày quanh 100 (600 nến 15m ≈ 6 ngày), rồi tuỳ kịch bản:
 *  - 'tu_choi'      : giá chạm trần cụm rồi ĐÓNG TRỞ LẠI trong cụm → từ chối mép.
 *  - 'chap_nhan_tren': hai nến 1h đóng và GIỮ trên trần cụm → chấp nhận ngoài, phía trên.
 */
function scenario(kind: 'tu_choi' | 'chap_nhan_tren'): Candle[] {
  T = Date.UTC(2026, 5, 1);
  const out: Candle[] = [];
  // Cụm dày 99.0–101.0, đỉnh phân bố ở 100.
  for (let i = 0; i < 600; i++) {
    const p = 100 + Math.sin(i / 11) * 0.9;
    out.push(bar(p, p + 0.12, p - 0.12, p, 400));
  }
  if (kind === 'tu_choi') {
    // Đẩy lên chạm trần rồi đóng lại trong cụm — bốn nến 15m = một nến 1h.
    out.push(bar(100.8, 101.6, 100.7, 101.4, 900, 0.62));
    out.push(bar(101.4, 101.9, 101.2, 101.7, 950, 0.60));
    out.push(bar(101.7, 101.95, 100.9, 101.0, 1100, 0.36));
    out.push(bar(101.0, 101.1, 100.2, 100.4, 1200, 0.32));
  } else {
    // Hai nến 1h đóng hẳn trên trần và giữ ở đó.
    for (const c of [102.2, 102.6, 102.9, 103.1, 103.0, 103.2, 103.4, 103.3]) {
      out.push(bar(c - 0.25, c + 0.2, c - 0.35, c, 1000, 0.6));
    }
  }
  return out;
}

const read = (c15: Candle[], tf: '1h' = '1h') => {
  const c1h: Candle[] = [];
  for (let i = 0; i + 3 < c15.length; i += 4) {
    const g = c15.slice(i, i + 4);
    c1h.push({
      t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)),
      c: g[3].c, v: g.reduce((s, x) => s + x.v, 0), q: g.reduce((s, x) => s + x.q, 0),
      takerBuyBase: g.reduce((s, x) => s + (x.takerBuyBase ?? 0), 0), closed: true,
    });
  }
  const layers = buildLayers(c15, c1h, c15[c15.length - 1].t + M15);
  return { r: readTF({ tf, candles: c1h, layers, last4hClosed: null, spotPerpAgree: true, fundingPoints: 0.5, oi: oiNA, hasPerpTaker: true, hasFunding: true }), layers, c1h };
};

describe('LỖI 1 — cửa "còn trong vùng" nuốt luôn setup TỪ CHỐI MÉP', () => {
  const { r, layers, c1h } = read(scenario('tu_choi'));

  it('máy nhận ra ĐÚNG là một cú từ chối mép trên', () => {
    const layer = referenceLayer(layers, '1h')!;
    const rej = edgeRejection(layer, c1h);
    expect(rej).not.toBeNull();
    expect(rej!.side).toBe('tren');
    expect(readState(layer, c1h, '1h').state).toBe('trong_vung');
  });

  it('đặc tả cho phép mở NGƯỢC CHIỀU MÉP sau nến đóng — nhưng máy vẫn đứng ngoài', () => {
    // Đặc tả mục E: "Từ chối mép ... → được phép mở ngược chiều mép sau nến đóng."
    // Từ chối mép TRÊN → được phép mở BÁN. Đây là đường vào lệnh chính trong
    // thị trường cân bằng, và nó đang là code chết.
    expect(r!.bias).toBe('ban');
    expect(r!.plan).not.toBeNull();
  });
});

describe('LỖI 2 — entry của lệnh MUA đặt ở mép sai', () => {
  const { r, layers, c1h } = read(scenario('chap_nhan_tren'));

  it('máy nhận ra giá đã rời hẳn cụm về phía trên', () => {
    const layer = referenceLayer(layers, '1h')!;
    const st = readState(layer, c1h, '1h');
    // Cả 'chấp nhận ngoài' lẫn 'vùng dịch' đều là "đi theo chiều rời"; điều bắt
    // buộc là KHÔNG được còn là 'trong vùng', và phía phải là trên.
    expect(st.state).not.toBe('trong_vung');
    expect(st.side).toBe('tren');
  });

  it('mua sau khi chấp nhận phía TRÊN phải chờ kéo về mép TRÊN (VAH), không phải VAL', () => {
    const layer = referenceLayer(layers, '1h')!;
    const st = readState(layer, c1h, '1h');
    // Nếu code lấy VAL cho lệnh mua thì entry rơi xuống đáy cụm, cách giá rất xa
    // và nằm sai phía hoàn toàn so với chỗ giá vừa bứt lên.
    if (r?.plan) {
      const mid = (r.plan.entry[0] + r.plan.entry[1]) / 2;
      expect(Math.abs(mid - st.edge.vah)).toBeLessThan(Math.abs(mid - st.edge.val));
    } else {
      // Không ra kế hoạch cũng phải nêu lý do, không im lặng.
      expect(r!.gate.fail_reasons.length).toBeGreaterThan(0);
    }
  });
});

describe('LỖI 3 — ternary chết chọn sai phía khi xin quyền', () => {
  it('nhánh true và false của biểu thức chọn phía là giống hệt nhau', () => {
    const src = require('node:fs').readFileSync('lib/tfRead.ts', 'utf8') as string;
    const m = src.match(/probe\.bias === 'dung_ngoai' \? \(([^)]*)\)/);
    if (m) {
      const both = m[1].split('?')[1];
      const [a, b] = both.split(':').map((x) => x.trim());
      expect(a).not.toBe(b);   // đỏ khi còn 'mua' : 'mua'
    }
  });
});
