'use client';

import { useServerInsertedHTML } from 'next/navigation';

const script = `(function(){try{var t=localStorage.getItem('smilesim-theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}var l=localStorage.getItem('smilesim-locale');if(l==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr';}else if(l==='he'||l==='ar'){document.documentElement.lang=l;document.documentElement.dir='rtl';}}catch(e){}})();`;

export function Bootstrap() {
  useServerInsertedHTML(() => (
    <script id="prefs-bootstrap" dangerouslySetInnerHTML={{ __html: script }} />
  ));
  return null;
}
