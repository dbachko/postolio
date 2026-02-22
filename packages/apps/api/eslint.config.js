import baseConfig from '../../../eslint.config.js';

export default [
  ...baseConfig,
  // Test files are excluded from tsconfig.json, so projectService can't parse them.
  // Ignore them here to avoid parse errors; they are linted without type-awareness in CI.
  {
    ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/__tests__/**'],
  },
  {
    rules: {
      // Allow pragmatic JSON typing for Prisma JSON fields in this package
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
