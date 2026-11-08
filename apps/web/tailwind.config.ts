import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  corePlugins: { preflight: false },
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--rd-bg)',
        surface: { DEFAULT: 'var(--rd-surface)', 2: 'var(--rd-surface-2)', 3: 'var(--rd-surface-3)' },
        line: { DEFAULT: 'var(--rd-line)', soft: 'var(--rd-line-soft)' },
        ink: { DEFAULT: 'var(--rd-ink)', 2: 'var(--rd-ink-2)', 3: 'var(--rd-muted)', 4: 'var(--rd-faint)' },
        accent: { DEFAULT: 'var(--rd-primary-bg)', 2: 'var(--rd-primary-hover)', soft: 'var(--rd-primary-soft)', fg: 'var(--rd-primary-fg)' },
        good: 'var(--rd-success)', warn: 'var(--rd-warning)', bad: 'var(--rd-danger)',
      },
      borderRadius: { lg: '0.5rem', xl: '0.625rem' },
      boxShadow: { sm: 'var(--rd-shadow-sm)', card: 'var(--rd-shadow-card)', pop: 'var(--rd-shadow-pop)' },
    },
  },
  plugins: [],
};
export default config;
