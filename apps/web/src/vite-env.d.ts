/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** dev-only：vite.config.ts 从根 .env 注入的 DeepSeek key（生产构建为空串） */
  readonly DEV_DEEPSEEK_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
