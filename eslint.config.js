// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // ─── Global ignores ──────────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.turbo/**',
      'coverage/**',
      'reports/**',
      '**/*.min.*',
      '**/*.snap',
      '**/.cache/**',
      'packages/libs/database-assets/assets-client/**',
      // Build-tool config files are not included in any project tsconfig and
      // cannot be type-checked by projectService — exclude them from linting.
      '**/vite.config.ts',
      '**/vitest.config.ts',
      '**/tsup.config.ts',
      '**/jest.config.ts',
      '**/playwright.config.ts',
      // E2E test files live outside tsconfig boundaries
      '**/tests/e2e/**',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // ─── Base rules (all TS/JS files) ────────────────────────────────────────────
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      parserOptions: {
        // Enable type-aware linting. `projectService` automatically discovers
        // the nearest tsconfig.json for each file, making this work correctly
        // in a monorepo with per-package tsconfigs.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── File size & complexity ────────────────────────────────────────────────
      //
      // Files over 400 meaningful lines (blank/comment lines excluded) are a
      // maintenance liability — they grow harder to review, test, and reason
      // about in isolation. Keeping files small forces modular design.
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],

      // Functions longer than 80 meaningful lines are difficult to understand
      // without scrolling. A function should do one thing; if it can't fit in
      // 80 lines it's doing too much. IIFEs count as they can hide complexity.
      'max-lines-per-function': [
        'warn',
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],

      // Cyclomatic complexity above 15 means too many independent paths through
      // a function — a signal to decompose into smaller, focused units.
      complexity: ['warn', { max: 15 }],

      // Beyond 4 levels of block nesting, code becomes hard to follow. Guard
      // clauses and early returns are the preferred remediation pattern.
      'max-depth': ['warn', { max: 4 }],

      // More than 5 parameters is a strong signal to use a config/options
      // object instead. This also improves call-site readability.
      'max-params': ['warn', { max: 5 }],

      // ── Variables & declarations ──────────────────────────────────────────────
      // Immutable bindings by default; use `let` only when reassignment is
      // intentional, never `var` (function-scoped variables cause confusion).
      'prefer-const': 'error',
      'no-var': 'error',

      // Duplicate imports from the same module should be merged into one
      // statement to keep the import section clean and avoid confusion.
      'no-duplicate-imports': 'error',

      // ── Control flow ──────────────────────────────────────────────────────────
      // Always require braces for control structures. Single-line bodies are a
      // common source of off-by-one bugs when a second statement is added later.
      curly: ['error', 'all'],

      // Strict equality prevents implicit type coercion surprises.
      // null is excluded: `x == null` is the idiomatic null-or-undefined check.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Guard clauses (early returns) are easier to follow than deeply nested
      // else branches. `allowElseIf: false` enforces the flat guard-clause style.
      'no-else-return': ['warn', { allowElseIf: false }],

      // Nested ternaries are notoriously hard to parse, especially when types
      // differ. Extract into variables or if/else for clarity.
      'no-nested-ternary': 'warn',

      // ── Code style ────────────────────────────────────────────────────────────
      // Method/property shorthand is standard ES6+ — reduces boilerplate:
      //   { foo: foo } → { foo }   |   { bar: function() {} } → { bar() {} }
      'object-shorthand': ['error', 'always'],

      // Template literals are more readable than string concatenation and handle
      // multi-line strings naturally. `'Hello ' + name` → `\`Hello ${name}\``
      'prefer-template': 'warn',

      // ── Debugging / observability ─────────────────────────────────────────────
      // console.log left in production code is usually a bug. Warn/error logging
      // via console.warn/console.error is acceptable in service code.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // ── Error handling ────────────────────────────────────────────────────────
      // Allow intentionally-empty catch blocks (we sometimes suppress benign errors).
      'no-empty': ['error', { allowEmptyCatch: true }],

      // ── React ─────────────────────────────────────────────────────────────────
      // Hook call order must be stable — calling hooks conditionally breaks React's
      // internal linked-list of hook state.
      'react-hooks/rules-of-hooks': 'error',
      // Missing deps in useEffect/useCallback/useMemo cause stale-closure bugs.
      'react-hooks/exhaustive-deps': 'warn',
      // Fast-refresh requires component modules to export only components so the
      // runtime can swap them without losing state.
      'react-refresh/only-export-components': 'warn',

      // ── TypeScript ────────────────────────────────────────────────────────────
      // Disable the base rule in favour of the TypeScript-aware version below.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // `any` silently disables type checking for an entire expression. Use
      // `unknown` and narrow, or at minimum document why `any` is necessary.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Optional chaining is safer and more readable:
      //   foo && foo.bar && foo.bar.baz  →  foo?.bar?.baz
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // `import type` communicates intent and allows build tools to strip the
      // import entirely, avoiding circular-dependency issues at runtime.
      // fixStyle: inline-type-imports → `import { type Foo, bar }` (no extra line)
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // A side-effect import that only imports types will be silently removed by
      // bundlers when type-only imports are used, which can cause runtime errors.
      '@typescript-eslint/no-import-type-side-effects': 'error',

      // Use T[] for simple element types; Array<T> for complex generics/unions.
      //   string[]  ✓    Array<string | null>  ✓    string | null[]  ✗
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],

      // Redundant explicit types on obviously-typed values add noise:
      //   const x: number = 5  →  const x = 5
      '@typescript-eslint/no-inferrable-types': 'warn',

      // `namespace` is a legacy TypeScript pattern. Use ES modules instead.
      '@typescript-eslint/no-namespace': 'error',
    },
  },

  // ─── Test file overrides (relaxed limits) ────────────────────────────────────
  // Tests are naturally verbose: each test case often sets up fixtures, acts,
  // and asserts — patterns that inflate line counts without reflecting real
  // design debt. Apply looser thresholds so legitimate test files don't trigger
  // false positives.
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
    rules: {
      'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-params': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      // Type assertions and non-null assertions are common in mocking/testing.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
