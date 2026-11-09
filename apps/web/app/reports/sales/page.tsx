import { redirect } from 'next/navigation';

// «المبيعات» left the reports (spec 2026-11-09-admin-review, 1): the sales are in «المالية», the totals in «الأرباح».
export default function Page() {
  redirect('/finance?scope=operations');
}
