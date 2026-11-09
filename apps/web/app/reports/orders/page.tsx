import { redirect } from 'next/navigation';

// «الطلبات» left the reports (spec 2026-11-09-admin-review, 1): finished ones are in «المالية», open ones in «المهام».
export default function Page() {
  redirect('/tasks');
}
