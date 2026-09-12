/**
 * Khoá HẾT ghi ra ĐĨA — chỉ dành cho bản TỰ HOST.
 *
 * ĐỌC KỸ TRƯỚC KHI TIN: trên Vercel và mọi nền serverless khác, đĩa cũng
 * ephemeral. File này KHÔNG cứu được cold start ở đó, và nó không giả vờ là
 * cứu được: không có chỗ ghi thật thì trả RAM kèm cảnh báo.
 *
 * Thứ THẬT SỰ cứu cold start là `nenGanDay` trong `evaluate()`: một thẻ đã chết
 * vì giá xuyên SL thì cây giết nó còn nguyên trong chuỗi nến, đọc lại được bất
 * cứ lúc nào. File này chỉ là đường tắt cho bản chạy liên tục, không phải nguồn
 * sự thật.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { taoKhoaHetRam, type KhoaHetRow, type KhoaHetStore } from './lifecycle';

export interface KetQuaKhoa {
  store: KhoaHetStore;
  /** Khoá có sống qua tiến trình không. */
  ben: boolean;
  /** Câu để đẩy vào `degraded`. Null khi không có gì phải nói. */
  canhBao: string | null;
  duong: string | null;
}

/** Nơi ghi sổ: KHOA_HET_PATH ưu tiên, sau đó SNAPSHOT_DIR/khoa-het.json. */
export function duongKhoaHet(): string | null {
  const p = process.env.KHOA_HET_PATH;
  if (p) return p;
  const d = process.env.SNAPSHOT_DIR;
  return d ? join(d, 'khoa-het.json') : null;
}

export function taoKhoaHetFile(duong = duongKhoaHet()): KetQuaKhoa {
  if (!duong) {
    return {
      store: taoKhoaHetRam(),
      ben: false,
      duong: null,
      canhBao: 'Khoá HẾT chỉ nằm trong bộ nhớ tiến trình (không có SNAPSHOT_DIR / '
        + 'KHOA_HET_PATH). Thẻ chết vì giá xuyên SL hoặc chạm chốt vẫn được dựng lại '
        + 'từ nến nên không mất; chỉ những trường hợp chỉ thấy được qua giá live '
        + '(trigger hỏng, hết hạn) là có thể quên sau khi server khởi động lại.',
    };
  }

  let seed: [string, KhoaHetRow][] = [];
  let hong: string | null = null;
  try {
    if (existsSync(duong)) {
      const raw = JSON.parse(readFileSync(duong, 'utf8')) as Record<string, KhoaHetRow>;
      seed = Object.entries(raw).filter(([, r]) => r && typeof r.ts === 'number');
    }
  } catch (e) {
    // Sổ hỏng thì bắt đầu lại từ rỗng — nhưng PHẢI báo: bắt đầu lại từ rỗng
    // nghĩa là các thẻ HẾT chỉ-thấy-qua-giá-live mất khoá.
    hong = `Sổ khoá HẾT tại ${duong} đọc không được (${(e as Error).message}) — đã bắt đầu lại từ rỗng.`;
  }

  const ram = taoKhoaHetRam(seed);
  const ghi = () => {
    try {
      mkdirSync(dirname(duong), { recursive: true });
      const tmp = `${duong}.tmp`;
      // Ghi file tạm rồi rename: chết giữa chừng thì sổ cũ còn nguyên thay vì
      // thành JSON cụt.
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(ram.entries())));
      renameSync(tmp, duong);
    } catch {
      // Đĩa hỏng thì khoá vẫn đúng trong RAM tiến trình này. Không ném, để một
      // lỗi ghi đĩa không giết cả lần quét.
    }
  };

  return {
    ben: true,
    duong,
    canhBao: hong,
    store: { get: (id) => ram.get(id), set: (id, row) => { ram.set(id, row); ghi(); } },
  };
}
