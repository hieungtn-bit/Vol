import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ScanSnapshot } from './types';

// Lưu snapshot để so lại về sau: "lúc đó hệ nói gì, giá đi đâu".
//
// Trên serverless (Vercel) đĩa chỉ ghi được ở /tmp và biến mất theo instance, nên
// snapshot ở đó là ảo tưởng lưu trữ — thà tắt và nói rõ còn hơn để người dùng tưởng
// mình đang có lịch sử. Muốn lưu thật thì trỏ SNAPSHOT_DIR vào volume/S3/DB.
const ON_SERVERLESS = !!process.env.VERCEL && !process.env.SNAPSHOT_DIR;
const DIR = ON_SERVERLESS ? '' : (process.env.SNAPSHOT_DIR ?? './data/snapshots');

export const SNAPSHOT_NOTE = ON_SERVERLESS
  ? 'Snapshot tắt trên serverless — đĩa ephemeral, không lưu được lịch sử. Chạy local hoặc trỏ SNAPSHOT_DIR vào ổ lưu trữ thật.'
  : null;

export async function saveSnapshot(snap: ScanSnapshot): Promise<string | null> {
  if (!DIR) return null;
  try {
    const dir = path.resolve(process.cwd(), DIR);
    await fs.mkdir(dir, { recursive: true });
    const name = `${new Date(snap.ts).toISOString().replace(/[:.]/g, '-')}.json`;
    const file = path.join(dir, name);
    await fs.writeFile(file, JSON.stringify(snap, null, 2), 'utf8');
    await prune(dir);
    return file;
  } catch {
    return null;   // lưu snapshot hỏng thì thôi, không được làm chết scan
  }
}

export async function listSnapshots(limit = 50): Promise<string[]> {
  try {
    const dir = path.resolve(process.cwd(), DIR);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort().reverse();
    return files.slice(0, limit);
  } catch {
    return [];
  }
}

export async function readSnapshot(name: string): Promise<ScanSnapshot | null> {
  if (!/^[\w.\-]+\.json$/.test(name)) return null;   // chặn path traversal
  try {
    const dir = path.resolve(process.cwd(), DIR);
    const raw = await fs.readFile(path.join(dir, name), 'utf8');
    return JSON.parse(raw) as ScanSnapshot;
  } catch {
    return null;
  }
}

/** Giữ 300 snapshot gần nhất — auto 60s sẽ đẻ ra rất nhiều file. */
async function prune(dir: string, keep = 300) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length <= keep) return;
  await Promise.all(files.slice(0, files.length - keep).map((f) => fs.rm(path.join(dir, f)).catch(() => {})));
}
