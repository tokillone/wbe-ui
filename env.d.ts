/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_HOME_OVERVIEW_API?: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
