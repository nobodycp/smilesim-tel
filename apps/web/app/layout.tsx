import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'سمايل سيم' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
