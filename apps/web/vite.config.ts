import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
// 开发态预填：dev server 启动时读仓库根目录 .env 的 DEEPSEEK_API_KEY，
// 注入 import.meta.env.DEV_DEEPSEEK_KEY（仅 dev；build 时为空串，key 不进产物）。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ command, mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, '')
  const devDeepseekKey = command === 'serve' ? (rootEnv.DEEPSEEK_API_KEY ?? '') : ''
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.DEV_DEEPSEEK_KEY': JSON.stringify(devDeepseekKey),
    },
  }
})
