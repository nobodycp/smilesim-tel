import { redirect } from 'next/navigation';

// The topbar path's «الرزم» level under a company: its packages tab (spec 2026-11-09-admin-review, 4).
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/companies/${encodeURIComponent(code)}`);
}
