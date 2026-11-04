# @postolio/tsconfig Presets

Centralized TypeScript configs for the monorepo. Use these to keep targets and module settings consistent.

## Presets

- `node-library.json`
  - Target: ES2022
  - Module: ESNext
  - Lib: ES2022
  - Strict, declaration + declarationMap enabled
  - Use for Node.js code: Lambda services, API, CDK, and Node-only libraries.

- `react-library.json`
  - Target: ESNext (bundler controls final output)
  - Module: ESNext; ModuleResolution: Bundler
  - Lib: ES2022, DOM, DOM.Iterable
  - Use for browser code: Vite/React apps and libraries.

## Usage

Extend the preset in your `tsconfig.json` and keep only package-specific overrides.

Node example:

```
{
  "extends": "@postolio/tsconfig/node-library.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src/**/*"]
}
```

React/Vite example:

```
{
  "extends": "@postolio/tsconfig/react-library.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

## Notes

- Lambdas run on Node.js 24.x (CDK sets `NODEJS_24_X`), so Node packages should compile for ES2022 and build for `node22`.
- Browser apps remain on `esnext` and DOM libs; bundlers (Vite/Rollup) downlevel per targets/browserslist.
