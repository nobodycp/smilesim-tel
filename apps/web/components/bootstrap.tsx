'use client';

import { useRef } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { LOCALE_KEY, THEME_KEY } from '../lib/document-prefs';

const script = `(function(){try{var root=document.documentElement;var localeKey=${JSON.stringify(LOCALE_KEY)};var themeKey=${JSON.stringify(THEME_KEY)};function cookie(name){var m=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}var cookieLocale=cookie(localeKey);var cookieTheme=cookie(themeKey);var storedLocale=localStorage.getItem(localeKey);var storedTheme=localStorage.getItem(themeKey);var hasLocale=cookieLocale==='en'||cookieLocale==='he'||cookieLocale==='ar';var hasTheme=cookieTheme==='dark'||cookieTheme==='light';var locale=hasLocale?cookieLocale:(storedLocale==='en'||storedLocale==='he'||storedLocale==='ar'?storedLocale:null);var theme=hasTheme?cookieTheme:(storedTheme==='dark'||storedTheme==='light'?storedTheme:null);var rendered=root.getAttribute('lang')||'ar';var renderedDark=root.classList.contains('dark');var mismatch=(!hasLocale&&locale!==null&&locale!==rendered)||(!hasTheme&&theme!==null&&((theme==='dark')!==renderedDark));if(mismatch){if(!hasLocale&&locale)document.cookie=localeKey+'='+locale+'; Path=/; Max-Age=31536000; SameSite=Lax';if(!hasTheme&&theme)document.cookie=themeKey+'='+theme+'; Path=/; Max-Age=31536000; SameSite=Lax';if(!sessionStorage.getItem('smilesim-prefs-sync')){sessionStorage.setItem('smilesim-prefs-sync','1');location.replace(location.href);return;}}else{try{sessionStorage.removeItem('smilesim-prefs-sync');}catch(e){}}var active=locale||rendered;var dark=theme==='dark'||(theme===null&&renderedDark);root.classList.toggle('dark',dark);root.style.colorScheme=dark?'dark':'light';root.lang=active;root.dir=active==='en'?'ltr':'rtl';var deskName='smilesim-name';var deskBal='smilesim-balance';var idRaw='';var balRaw='';try{idRaw=sessionStorage.getItem('smilesim-identity')||'';}catch(e){}try{balRaw=sessionStorage.getItem('smilesim-balance')||'';}catch(e){}var sync=false;if(idRaw){try{var id=JSON.parse(idRaw);if(id&&typeof id.account==='string'&&id.account&&cookie(deskName)!==id.account){document.cookie=deskName+'='+encodeURIComponent(id.account)+'; Path=/; Max-Age=31536000; SameSite=Lax';sync=true;}}catch(e){}}if(balRaw&&cookie(deskBal)!==balRaw){document.cookie=deskBal+'='+encodeURIComponent(balRaw)+'; Path=/; Max-Age=31536000; SameSite=Lax';sync=true;}if(sync){if(!sessionStorage.getItem('smilesim-desk-sync')){sessionStorage.setItem('smilesim-desk-sync','1');location.replace(location.href);return;}}else{try{sessionStorage.removeItem('smilesim-desk-sync');}catch(e){}}}catch(e){}})();`;

/** The inline script is allowed by the per-request CSP nonce that proxy.ts generates. */
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
