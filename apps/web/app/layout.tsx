import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { IBM_Plex_Sans_Hebrew, Tajawal } from 'next/font/google';
import { Bootstrap } from '../components/bootstrap';
import { Toasts } from '../components/toast';
import { Doors } from '../components/doors';
import { Preferences } from '../components/preferences';
import { DoorProvider } from '../lib/door-context';
import { doorFromHost } from '../lib/doors';
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

export const metadata = { title: 'سمايل سيم' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const host = (await headers()).get('host') ?? '';
  const door = doorFromHost(host);
  return (
    <html lang="ar" dir="rtl" className={`${sans.variable} ${hebrew.variable}`} suppressHydrationWarning>
      <body>
        <Bootstrap />
        <Preferences>
          <Toasts>
          {door ? (
            <DoorProvider door={door}>
              <OfficeSession>{children}</OfficeSession>
            </DoorProvider>
          ) : (
            <Doors host={host} />
          )}
          </Toasts>
        </Preferences>
      </body>
    </html>
  );
}
