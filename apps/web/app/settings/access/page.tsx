import { redirect } from 'next/navigation';

// The layers' session defaults live on each layer's role in «الأدوار» (spec 2026-11-09-admin-review, 6.1).
export default function Page() {
  redirect('/roles');
}
