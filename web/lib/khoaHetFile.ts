/**
 * Khoá HẾT ghi ra ĐĨA.
 *
 * Map trong RAM chết theo tiến trình: mỗi cold start là một RAM mới, nên thẻ đã
 * HẾT sống lại ở lần quét sau. Đây là file cất nó xuống đĩa.
 *
 * `evaluate()` đồng bộ, nên nạp cả sổ vào bộ nhớ một lần lúc dựng store, `get`
 * đọc bộ nhớ, `set` ghi đè cả file (sổ này vài KB — ghi lại toàn bộ đơn giản và
 * an toàn hơn append rồi phải gộp).
 *
 * Ghi qua file tạm rồi rename: nếu tiến trình chết giữa chừng thì sổ cũ còn
 * nguyên thay vì thành file JSON cụt.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { taoKhoaHetRam, type KhoaHetRow, type KhoaHetStore } from './lifecycle';

export interface KetQuaKhoa {
  store: KhoaHetStore;
  /** Khoá có sống qua tiến trình không. */
  ben: boolean;
  /** Câu để đẩy vào `degraded` khi không bền. Null khi bền. */
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

/**
 * Dựng store. Không có chỗ ghi → trả RAM kèm CẢNH BÁO, không giả vờ là bền.
 * Vercel và các nền serverless khác không có SNAPSHOT_DIR: ở đó khoá HẾT chỉ
 * sống trong một tiến trình, và trang phải nói thẳng điều đó.
 */
export function taoKhoaHetFile(duong = duongKhoaHet()): KetQuaKhoa {
  if (!duong) {
    return {
      store: taoKhoaHetRam(),
      ben: false,
      duong: null,
      canhBao: 'Khoá HẾT không bền trên nền ephemeral (không có SNAPSHOT_DIR / '
        + 'KHOA_HET_PATH). Sau khi tiến trình khởi động lại, một thẻ đã HẾT có thể '
        + 'hiện lại ở trạng thái khác — đọc lại trạng thái trước khi vào tiền.',
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
    // Sổ hỏng thì bắt đầu lại từ rỗng — nhưng PHẢI báo, vì bắt đầu lại từ rỗng
    // nghĩa là mọi thẻ đã HẾT đều mất khoá.
    hong = `Sổ khoá HẾT tại ${duong} đọc không được (${(e as Error).message}) — `
      + 'đã bắt đầu lại từ rỗng, các thẻ HẾT cũ mất khoá.';
  }

  const ram = taoKhoaHetRam(seed);
  let dangGhi = false;

  const ghi = () => {
    if (dangGhi) return;
    dangGhi = true;
    try {
      mkdirSync(dirname(duong), { recursive: true });
      const obj = Object.fromEntries(ram.entries());
      const tmp = `${duong}.tmp`;
      writeFileSync(tmp, JSON.stringify(obj));
      renameSync(tmp, duong);
    } catch {
      // Ghi hỏng thì khoá vẫn đúng trong RAM của tiến trình này; lần quét sau
      // trong cùng tiến trình vẫn thấy. Không ném để một lỗi đĩa không giết cả
      // lần quét.
    } finally {
      dangGhi = false;
    }
  };

  return {
    ben: true,
    duong,
    canhBao: hong,
    store: {
      get: (id) => ram.get(id),
      set: (id, row) => { ram.set(id, row); ghi(); },
    },
  };
}
