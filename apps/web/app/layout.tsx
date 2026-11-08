import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { IBM_Plex_Sans_Hebrew, Tajawal } from 'next/font/google';
import { Bootstrap } from '../components/bootstrap';
import { Toasts } from '../components/toast';
import { Doors } from '../components/doors';
import { OfficeFrame } from '../components/office-frame';
import { Preferences } from '../components/preferences';
import { BrandingProvider } from '../lib/branding';
import { brandingImageUrl, loadBranding } from '../lib/branding-load';
import { copy } from '../lib/copy';
import { DoorProvider } from '../lib/door-context';
import { doorFromHost } from '../lib/doors';
import { BALANCE_COOKIE, dirFor, LOCALE_KEY, NAME_COOKIE, PAGE_SIZE_KEY, parseLocale, parsePageSize, parseTheme, THEME_KEY } from '../lib/document-prefs';
import { QueryProvider } from '../lib/query';
import { OfficeSession } from '../lib/office-session';
import './globals.css';

const sans = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

const hebrew = IBM_Plex_Sans_Hebrew({
  subsets: ['hebrew'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-he',
  display: 'swap',
});

// The `<title>` is rendered by the shell (section · brand) or, off the office, below; it is not
// metadata, so a route change cannot reset it to the brand alone.
export async function generateMetadata(): Promise<Metadata> {
  const seed = await loadBranding();
  return {
    // Without a saved icon, Next keeps serving app/icon.svg.
    ...(seed.hasFavicon ? { icons: { icon: brandingImageUrl('favicon', seed.version) } } : {}),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const jar = await cookies();
  const host = requestHeaders.get('host') ?? '';
  // Set per request by proxy.ts; the CSP only lets the bootstrap script run with this nonce.
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  const door = doorFromHost(host);
  const locale = parseLocale(jar.get(LOCALE_KEY)?.value);
  const theme = parseTheme(jar.get(THEME_KEY)?.value);
  const initialName = jar.get(NAME_COOKIE)?.value ?? '';
  const balanceCookie = jar.get(BALANCE_COOKIE)?.value;
  const parsedBalance = balanceCookie === undefined || balanceCookie === '' ? null : Number(balanceCookie);
  const initialBalance = parsedBalance !== null && Number.isFinite(parsedBalance) ? parsedBalance : null;
  const branding = await loadBranding();
  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={[sans.variable, hebrew.variable, theme === 'dark' ? 'dark' : ''].filter(Boolean).join(' ')}
      style={{ colorScheme: theme }}
      suppressHydrationWarning
    >
      <body>
        <Bootstrap nonce={nonce} />
        <Preferences locale={locale} theme={theme} pageSize={parsePageSize(jar.get(PAGE_SIZE_KEY)?.value)}>
          <BrandingProvider seed={branding}>
          <Toasts>
          {door ? (
            <QueryProvider>
              <DoorProvider door={door}>
                <OfficeSession initialName={initialName} initialBalance={initialBalance}>
                  <OfficeFrame>{children}</OfficeFrame>
                </OfficeSession>
              </DoorProvider>
            </QueryProvider>
          ) : (
            <>
              <title>{branding.siteName || copy[locale].brand}</title>
              <Doors host={host} name={branding.siteName} />
            </>
          )}
          </Toasts>
          </BrandingProvider>
        </Preferences>
      </body>
    </html>
  );
}
