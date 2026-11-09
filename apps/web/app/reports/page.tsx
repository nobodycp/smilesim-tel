import { redirect } from 'next/navigation';

// `/reports` opens the first report, «المالية» (spec 2026-11-09-admin-review, 1).
export default function Page() {
  redirect('/finance');
}
