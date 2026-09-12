/**
 * Nạp lịch sử DÀI cho đúng những mã đang đo — không thêm mã, chỉ kéo dài thời gian.
 *
 * `fetchKlinesHistory` phân trang lùi bằng `endTime` nên đi ngược bao xa cũng
 * được; thứ duy nhất phải trả là số request. Một lần chạy 4 năm × 6 mã × 3 khung
 * là hơn một nghìn request, mà một buổi đo thì phải chạy lại nhiều lần — nên
 * đệm xuống đĩa. Lần chạy sau đọc đĩa, không đụng mạng.
 *
 * Đệm nằm trong `.cache/` (đã ignore): tải lại được, không vào git.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchKlinesHistory, TF_MS } from '../lib/sources';
import type { Candle, TF } from '../lib/types';

const THU_MUC = join(process.cwd(), '.cache', 'hist');

interface Dem {
  /** Số nến đã xin lúc tải. Nếu lần này xin ít hơn thì cắt đuôi, khỏi tải lại. */
  soNenDaXin: number;
  taiLuc: number;
  nen: Candle[];
}

/** Số nến cần để phủ `nam` năm trên khung `tf`. */
export function soNenChoNam(tf: TF, nam: number): number {
  return Math.ceil((nam * 365.25 * 24 * 3600_000) / TF_MS[tf]);
}

export interface PhamVi {
  symbol: string;
  tf: TF;
  soNen: number;
  tu: number;
  den: number;
  /** Lấy từ đĩa hay từ mạng — để biết lần chạy này có gọi Binance không. */
  nguon: 'đĩa' | 'mạng';
}

/**
 * Trả nến và phạm vi thời gian thật sự lấy được. KHÔNG tự bù khi mã niêm yết
 * muộn (ENA lên sàn 2024) — trả đúng thứ có, rồi báo cáo ghi rõ mã nào ngắn.
 */
export async function nenDai(
  symbol: string,
  tf: TF,
  soNen: number,
): Promise<{ nen: Candle[]; pv: PhamVi }> {
  mkdirSync(THU_MUC, { recursive: true });
  const duong = join(THU_MUC, `${symbol}-${tf}.json`);

  let nen: Candle[] | null = null;
  let nguon: PhamVi['nguon'] = 'mạng';

  if (existsSync(duong)) {
    try {
      const d = JSON.parse(readFileSync(duong, 'utf8')) as Dem;
      // Đệm chỉ dùng được khi nó xin ÍT NHẤT bằng lần này. Xin nhiều hơn mà
      // đọc đệm cũ là âm thầm đo trên mẫu ngắn hơn mình tưởng.
      if (d.soNenDaXin >= soNen && Array.isArray(d.nen)) {
        nen = d.nen.slice(-soNen);
        nguon = 'đĩa';
      }
    } catch {
      // đệm hỏng thì tải lại, không im lặng dùng số rác
    }
  }

  if (!nen) {
    nen = await fetchKlinesHistory(symbol, tf, soNen);
    const d: Dem = { soNenDaXin: soNen, taiLuc: Date.now(), nen };
    writeFileSync(duong, JSON.stringify(d));
  }

  return {
    nen,
    pv: {
      symbol, tf, soNen: nen.length, nguon,
      tu: nen.length ? nen[0].t : 0,
      den: nen.length ? nen[nen.length - 1].t : 0,
    },
  };
}

export const ngay = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
