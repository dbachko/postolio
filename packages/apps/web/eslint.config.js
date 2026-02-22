import baseConfig from '../../../eslint.config.js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  ...baseConfig,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Transitional relaxations (frontend currently heavy with any/unused vars)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',
      // Disallow importing UI primitives from outside the canonical alias path
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../ui/*',
                './ui/*',
                '../components/ui/*',
                '../../components/ui/*',
                'src/components/ui/*',
              ],
              message:
                'Import UI primitives from the canonical alias: "@/components/ui/<component>".',
            },
          ],
        },
      ],
    },
  },
  // Component-module conventions (avoid barrels; keep entry files readable)
  {
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**/*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message:
            'Re-exports are not allowed in src/components. Import from the defining file instead.',
        },
        {
          selector: 'ExportNamedDeclaration[source]',
          message:
            'Re-exports are not allowed in src/components. Import from the defining file instead.',
        },
      ],
    },
  },
  // In component modules, types/constants/utils should be imported directly from their files.
  // Avoid exporting types from `index.tsx` so consumers don’t depend on “index as a barrel”.
  {
    files: ['src/components/**/index.tsx'],
    ignores: ['src/components/ui/**/*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message:
            'Re-exports are not allowed in src/components. Import from the defining file instead.',
        },
        {
          selector: 'ExportNamedDeclaration[source]',
          message:
            'Re-exports are not allowed in src/components. Import from the defining file instead.',
        },
        {
          selector: 'ExportNamedDeclaration[exportKind="type"]',
          message:
            'Do not export types from component index.tsx. Put them in types.ts and import directly.',
        },
        {
          selector: 'ExportNamedDeclaration[declaration.type="TSInterfaceDeclaration"]',
          message:
            'Do not export interfaces from component index.tsx. Put them in types.ts and import directly.',
        },
        {
          selector: 'ExportNamedDeclaration[declaration.type="TSTypeAliasDeclaration"]',
          message:
            'Do not export types from component index.tsx. Put them in types.ts and import directly.',
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**/*'],
    rules: {
      'max-lines': [
        'warn',
        {
          // Target: ~200-300 lines for React component files.
          // Using warn so violations are visible without blocking commits;
          // fix in a dedicated refactoring session.
          max: 300,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.ts'],
    ignores: ['src/components/ui/**/*'],
    rules: {
      'max-lines': [
        'warn',
        {
          // Allow slightly larger non-UI modules (hooks/utils) while still
          // flagging runaway files for future extraction.
          max: 400,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
];
