import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// The TypeScript plugin Next's config already registers, reused for the rule below.
const typescript = nextCoreWebVitals.find((entry) => entry.plugins?.['@typescript-eslint'])?.plugins['@typescript-eslint'];

const config = [
  {
    // Generated output: the default build, every NEXT_DIST_DIR variant (.next-e2e, .next-audit, .next-infra ...), and test artefacts.
    ignores: ['.next/**', '.next-*/**', '.next-e2e/**', '.next-audit/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts'],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // The React 19 hooks plugin that ships with Next 16 flags setState inside effects.
      // These effects read the URL, localStorage, or a loaded list into state. They stay until that pass.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Dead imports and variables are errors: nine unused useLoad imports went unseen in Phase 4.5b.
    files: ['**/*.{ts,tsx}'],
    plugins: { '@typescript-eslint': typescript },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];

export default config;
