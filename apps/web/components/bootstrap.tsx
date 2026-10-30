'use client';

import { useRef } from 'react';
import { useServerInsertedHTML } from 'next/navigation';

const script = `(function(){try{var t=localStorage.getItem('smilesim-theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}var l=localStorage.getItem('smilesim-locale');if(l==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr';}else if(l==='he'||l==='ar'){document.documentElement.lang=l;document.documentElement.dir='rtl';}}catch(e){}})();`;

/** The inline script is allowed by the per-request CSP nonce that middleware.ts generates. */
export function Bootstrap({ nonce }: { nonce?: string }) {
  // Next calls this once per streamed chunk; the script is needed once per document.
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <script id="prefs-bootstrap" nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
  });
  return null;
}
