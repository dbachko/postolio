const globals = require('globals');
const tseslint = require('typescript-eslint');
const tsParser = require('@typescript-eslint/parser');

/**
 * Shared ESLint configuration for non-React packages (libs, services).
 * React-specific rules live in the root eslint.config.js which all
 * packages extend via `import baseConfig from '../../../eslint.config.js'`.
 *
 * This shared config is available for packages that cannot import the root
 * config directly (e.g. published packages or isolated tooling).
 */
module.exports = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // ── File size & complexity ──────────────────────────────────────────────
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['warn', { max: 15 }],
      'max-depth': ['warn', { max: 4 }],
      'max-params': ['warn', { max: 5 }],

      // ── Variables & declarations ────────────────────────────────────────────
      'prefer-const': 'error',
      'no-var': 'error',
      'no-duplicate-imports': 'error',

      // ── Control flow ────────────────────────────────────────────────────────
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-else-return': ['warn', { allowElseIf: false }],
      'no-nested-ternary': 'warn',

      // ── Code style ──────────────────────────────────────────────────────────
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-empty': ['error', { allowEmptyCatch: true }],

      // ── TypeScript ──────────────────────────────────────────────────────────
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/no-namespace': 'error',
    },
  },

  // ─── Test file overrides ────────────────────────────────────────────────────
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/test/**/*.ts',
      '**/test/**/*.tsx',
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.tsx',
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        test: 'readonly',
      },
    },
    rules: {
      'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-params': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
