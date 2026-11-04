'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent } from 'react';
import { usePrefs } from '../lib/prefs';

export function BackLink({ href }: { href: string }) {
  const { locale, t } = usePrefs();
  const router = useRouter();
  const BackIcon = locale === 'en' ? ArrowLeft : ArrowRight;

  function go(event: MouseEvent<HTMLAnchorElement>) {
    let same = false;
    try {
      same = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
      same = false;
    }
    if (!same) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link className="back-link" href={href} onClick={go}>
      <BackIcon aria-hidden="true" />
      {t.back}
    </Link>
  );
}
