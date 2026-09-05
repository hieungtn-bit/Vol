import { redirect } from 'next/navigation';

/** Bản điện đã dời lên trang chủ. Giữ /live để link cũ không chết. */
export default function LiveMoved() {
  redirect('/');
}
