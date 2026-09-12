import { NextResponse } from 'next/server';
import bangJson from '@/data/phan-phoi.json';
import { fetchKlines } from '@/lib/sources';
import {
  CUA_SO_TB, oCua, soSanh, TEN_BIEN_DONG, TEN_VI_TRI, TOI_THIEU, trangThaiTai,
  type BangPhanPhoi, type SoSanh, type TomTat, type TrangThai,
} from '@/lib/phanPhoi';
import type { TF } from '@/lib/types';

export const dynamic = 'force-dynamic';

const BANG = bangJson as unknown as BangPhanPhoi;

export interface DongChanTroi {
  ten: string;
  gio: number;
  voDieuKien: TomTat;
  coDieuKien: TomTat | null;
  sosanh: SoSanh | null;
  /** Câu kết luận đã viết sẵn — trang chỉ in ra, không tự diễn giải. */
  ketLuan: string;
}

export interface MaPhanTich {
  symbol: string;
  gia: number | null;
  trangThai: TrangThai | null;
  o: string | null;
  moTaO: string | null;
  tuNgay: string;
  denNgay: string;
  soNen: number;
  chanTroi: DongChanTroi[];
  loi: string | null;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('symbols');
  const symbols = (q ? q.split(',') : Object.keys(BANG.bang)).map((s) => s.trim().toUpperCase());

  const ra: MaPhanTich[] = await Promise.all(symbols.map(async (symbol): Promise<MaPhanTich> => {
    const b = BANG.bang[symbol];
    const rong = {
      symbol, gia: null, trangThai: null, o: null, moTaO: null,
      tuNgay: b?.tuNgay ?? '—', denNgay: b?.denNgay ?? '—', soNen: b?.soNen ?? 0,
      chanTroi: [] as DongChanTroi[],
    };
    if (!b) return { ...rong, loi: `chưa dựng bảng cho ${symbol}` };

    // Chỉ cần đủ nến để tính trạng thái hôm nay (240 + 120), không cần 5 năm.
    let nen;
    try {
      nen = (await fetchKlines(symbol, '1h' as TF, 500)).filter((c) => c.closed);
    } catch (e) {
      return { ...rong, loi: `không lấy được nến 1H: ${(e as Error).message}` };
    }
    if (nen.length < CUA_SO_TB + 1) return { ...rong, loi: `chỉ có ${nen.length} nến 1H đã đóng` };

    const t = trangThaiTai(nen, nen.length - 1);
    if (!t) return { ...rong, loi: 'không tính được trạng thái hiện tại' };

    const o = oCua(t, b.nguongBienDong);
    const [iv, ib] = o.split('-').map(Number);

    const chanTroi = BANG.chanTroi.map((ct, i): DongChanTroi => {
      const vo = b.voDieuKien[i];
      const co = b.oNhom[o]?.[i] ?? null;
      if (!co || co.n < TOI_THIEU) {
        return {
          ten: ct.ten, gio: ct.gio, voDieuKien: vo, coDieuKien: co, sosanh: null,
          ketLuan: co
            ? `Chỉ ${co.n} đoạn độc lập ở trạng thái này — dưới ${TOI_THIEU}, không đủ để tóm tắt.`
            : 'Chưa từng có đoạn nào ở trạng thái này trong mẫu.',
        };
      }
      const ss = soSanh(vo, co);
      return {
        ten: ct.ten, gio: ct.gio, voDieuKien: vo, coDieuKien: co, sosanh: ss,
        ketLuan: ss.dangKe
          ? `Hiệu ${(ss.dP * 100).toFixed(1)}pp vượt hai lần sai số (±${(ss.seP * 100).toFixed(1)}) — `
            + 'trạng thái này CÓ dịch được phân phối.'
          : `Hiệu ${ss.dP >= 0 ? '+' : ''}${(ss.dP * 100).toFixed(1)}pp nằm trong sai số `
            + `(±${(ss.seP * 100).toFixed(1)}) — trạng thái hôm nay KHÔNG nói được gì về hướng.`,
      };
    });

    return {
      symbol, gia: t.gia, trangThai: t, o,
      moTaO: `${TEN_VI_TRI[iv]} · ${TEN_BIEN_DONG[ib]}`,
      tuNgay: b.tuNgay, denNgay: b.denNgay, soNen: b.soNen,
      chanTroi, loi: null,
    };
  }));

  return NextResponse.json({
    ok: true,
    taoBangLuc: BANG.taoLuc,
    nguon: BANG.nguon,
    toiThieu: TOI_THIEU,
    ma: ra,
  });
}
