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
];
