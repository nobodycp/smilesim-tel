import { redirect } from 'next/navigation';

// «العمليات» became «المالية» → «العمليات فقط» (spec 2026-11-09-admin-review, 1).
export default function Page() {
  redirect('/finance?scope=operations');
}
