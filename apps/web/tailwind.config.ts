import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  corePlugins: { preflight: false },
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)', 3: 'var(--surface-3)' },
        line: { DEFAULT: 'var(--line)', soft: 'var(--line-soft)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)' },
        accent: { DEFAULT: 'var(--accent)', 2: 'var(--accent-2)', soft: 'var(--accent-soft)', fg: 'var(--accent-fg)' },
        good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)',
      },
      borderRadius: { lg: '0.5rem', xl: '0.625rem' },
      boxShadow: { card: 'var(--shadow-card)', pop: 'var(--shadow-pop)' },
    },
  },
  plugins: [],
};
export default config;
