import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params;
  redirect(scope === 'audit' ? '/audit' : '/operations');
}
