import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

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
];

export default config;
