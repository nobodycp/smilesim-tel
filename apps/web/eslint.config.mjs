import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // Generated output: the default build, every NEXT_DIST_DIR variant (.next-e2e, .next-audit, .next-infra ...), and test artefacts.
    ignores: ['.next/**', '.next-*/**', '.next-e2e/**', '.next-audit/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
