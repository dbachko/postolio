/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ASSETS_API_URL?: string;
  readonly VITE_DEMO_BRAND_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
