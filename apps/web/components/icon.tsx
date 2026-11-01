import type { ReactNode } from 'react';

export type IconName =
  | 'home'
  | 'settings'
  | 'wallet'
  | 'bell'
  | 'plans'
  | 'numbers'
  | 'providers'
  | 'tasks'
  | 'staff'
  | 'reports'
  | 'lock'
  | 'menu'
  | 'close'
  | 'chevron'
  | 'logout'
  | 'collapse'
  | 'expand'
  | 'sim';

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="M4 11.2 12 4.5l8 6.7" /><path d="M7 10.2V19.5h10V10.2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.2v1.8M12 19v1.8M5.8 5.8l1.25 1.25M16.95 16.95l1.25 1.25M3.2 12h1.8M19 12h1.8M5.8 18.2l1.25-1.25M16.95 7.05l1.25-1.25" /></>,
    wallet: <><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M3.5 10h17M15.5 14h2" /></>,
    bell: <><path d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2H4.5L6 16z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    plans: <><path d="M7 4.5h7.2L18.5 8.8V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5z" /><path d="M8.5 13h7M8.5 16.5h5" /></>,
    numbers: <><rect x="8" y="3" width="8" height="18" rx="2" /><path d="M11 18.5h2" /></>,
    providers: <><rect x="5" y="8.5" width="14" height="9" rx="2" /><path d="M8 8.5V6.8A2.2 2.2 0 0 1 10.2 4.6h3.6A2.2 2.2 0 0 1 16 6.8v1.7" /></>,
    tasks: <><path d="M8 5.5h8M8 12h8M8 18.5h5" /><path d="M4.5 5.5h.01M4.5 12h.01M4.5 18.5h.01" /></>,
    staff: <><circle cx="9" cy="8" r="2.4" /><circle cx="16" cy="9" r="2" /><path d="M4.8 18.2c.6-2.4 2.4-3.7 4.2-3.7s3.6 1.3 4.2 3.7M14 14.6c1.3-.3 2.6.2 3.4 1.6.6 1 .9 1.8.9 2" /></>,
    reports: <><path d="M5 19.5V10M10 19.5V5.5M15 19.5v-6M20 19.5V8" /></>,
    lock: <><rect x="6" y="11" width="12" height="8" rx="1.5" /><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevron: <path d="M7 10l5 5 5-5" />,
    logout: <><path d="M10 5.5H6.5A1.5 1.5 0 0 0 5 7v10a1.5 1.5 0 0 0 1.5 1.5H10" /><path d="M13 8.5 16.5 12 13 15.5M9 12h7.2" /></>,
    collapse: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M14 5v14M10 10l2 2-2 2" /></>,
    expand: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M10 5v14M14 10l-2 2 2 2" /></>,
    sim: <><path d="M7.5 3.5h5.7L19 9.2V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1.5-1.5z" /><rect x="9" y="13.5" width="6" height="6" rx="1" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
