import { describe, expect, it } from 'vitest';
import { unzipFirst } from '@/lib/minute';
import { deflateRawSync } from 'node:zlib';

/**
 * Bẫy im lặng: một số file trong kho KHÔNG có dòng tiêu đề. Cắt cứng dòng đầu sẽ
 * nuốt mất dòng dữ liệu đầu tiên của cả tháng đó — không lỗi, không cảnh báo,
 * chỉ thiếu một cây nến ở đầu mỗi tháng.
 *
 * `rows()` nằm trong archiveDeriv.ts và không export, nên kiểm gián tiếp qua đúng
 * luật mà nó dùng: trường đầu là số thì đó là dữ liệu, không phải tiêu đề.
 */
function rowsRule(csv: string): string[] {
  const all = csv.split('\n').map((l) => l.trim()).filter(Boolean);
  if (all.length === 0) return all;
  const first = all[0].split(',')[0];
  return Number.isFinite(Number(first)) && first !== '' ? all : all.slice(1);
}

describe('nhận diện dòng tiêu đề bằng nội dung, không bằng vị trí', () => {
  it('file CÓ tiêu đề: bỏ đúng một dòng', () => {
    const csv = 'open_time,open,high\n1782864000000,1,2\n1782867600000,3,4\n';
    expect(rowsRule(csv)).toHaveLength(2);
    expect(rowsRule(csv)[0]).toMatch(/^1782864000000/);
  });

  it('file KHÔNG tiêu đề: giữ nguyên mọi dòng — đây là chỗ từng mất dữ liệu', () => {
    const csv = '1782864000000,1,2\n1782867600000,3,4\n';
    expect(rowsRule(csv)).toHaveLength(2);
    expect(rowsRule(csv)[0]).toMatch(/^1782864000000/);
  });

  it('mốc thời gian dạng ngày giờ (metrics) vẫn bị coi là tiêu đề? KHÔNG', () => {
    // create_time của metrics là "2026-07-15 00:00:00" — Number() ra NaN, nên
    // luật trên sẽ cắt mất dòng đầu. Đó là lý do metrics dùng file CÓ tiêu đề và
    // ta phải biết điều đó, chứ không đoán.
    const csv = 'create_time,symbol\n2026-07-15 00:00:00,ENAUSDT\n';
    expect(rowsRule(csv)).toHaveLength(1);
    expect(rowsRule(csv)[0]).toMatch(/^2026-07-15/);
  });

  it('file rỗng không làm nổ hàm', () => {
    expect(rowsRule('')).toEqual([]);
    expect(rowsRule('\n\n')).toEqual([]);
  });

  it('ZIP không nén (method 0) cũng đọc được', () => {
    const body = 'a,b\n1,2\n';
    const name = Buffer.from('x.csv');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(0, 8);              // stored
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(body.length, 22);
    head.writeUInt16LE(name.length, 26);
    expect(unzipFirst(Buffer.concat([head, name, Buffer.from(body)]))).toBe(body);
    // và bản nén cũng vậy
    const raw = deflateRawSync(Buffer.from(body));
    const h2 = Buffer.from(head);
    h2.writeUInt16LE(8, 8);
    h2.writeUInt32LE(raw.length, 18);
    expect(unzipFirst(Buffer.concat([h2, name, raw]))).toBe(body);
  });
});
