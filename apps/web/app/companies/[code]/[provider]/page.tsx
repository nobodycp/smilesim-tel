import { redirect } from 'next/navigation';

// A company's packages from one provider are the company's «الرزم» tab filtered by it (spec 2026-11-09-admin-review, 4).
export default async function Page({ params }: { params: Promise<{ code: string; provider: string }> }) {
  const { code, provider } = await params;
  redirect(`/companies/${encodeURIComponent(code)}?provider=${encodeURIComponent(provider)}`);
}
