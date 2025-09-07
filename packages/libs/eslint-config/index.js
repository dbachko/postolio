const globals = require("globals");
const tseslint = require("typescript-eslint");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { "argsIgnorePattern": "^_" }
      ]
    },
  },
  // Configuration for test files
  {
    files: ["**/test/**/*.ts", "**/test/**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.jest, // vitest uses jest globals
        "vi": "readonly",
        "describe": "readonly",
        "it": "readonly",
        "expect": "readonly",
        "beforeEach": "readonly",
        "afterEach": "readonly",
        "beforeAll": "readonly",
        "afterAll": "readonly",
        "test": "readonly"
      }
    }
  }
];


