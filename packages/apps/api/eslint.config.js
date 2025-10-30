import baseConfig from '../../../eslint.config.js';

export default [
  ...baseConfig,
  {
    rules: {
      // Allow pragmatic JSON typing for Prisma JSON fields in this package
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
