import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SIZE_EXCEPTIONS = [
  'src/modules/office/companies/companies.service.ts',
  'src/modules/office/desk/overview.service.ts',
  'src/modules/office/providers/provider-catalog.service.ts',
  'src/modules/office/tasks/tasks.service.ts',
  'src/modules/office/tree-fixture.ts',
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  { files: ['**/*.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    // Jest declares a global `fail()`. Outside specs, a missing `import { fail }` would compile against it and
    // silently stop throwing OfficeFailure.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: { 'no-restricted-globals': ['error', { name: 'fail', message: "Import fail from 'modules/shared/office-failure'." }] },
  },
  {
    // backend-engineering.mdc 5.3: a function is at most 80 lines, a file at most 600.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts', 'src/**/testing/**', 'src/**/*.fixture.ts', 'src/generated/**'],
    rules: {
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // The functions and files that were over the limit when the rule was written. This list may only shrink:
    // split the function, then remove its file from here. Never add a file.
    files: SIZE_EXCEPTIONS,
    rules: { 'max-lines-per-function': 'off', 'max-lines': 'off' },
  },
);
