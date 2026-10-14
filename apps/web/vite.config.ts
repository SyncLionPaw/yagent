import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
// 开发态预填：dev server 启动时读仓库根目录 .env 的 DEEPSEEK_API_KEY，
// 以及 ~/.cc-switch 的当前 Claude 渠道（复用 cc-switch 的 key 配置，Anthropic 兼容），
// 注入 import.meta.env.DEV_*（仅 dev；build 时为空值，key 不进产物）。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

interface CcSwitchConf {
  token: string
  baseURL: string
  model: string
  name: string
}

/** 读 cc-switch 当前 Claude 渠道；任何一步失败都返回 null（不阻塞 dev server） */
function readCcSwitch(): CcSwitchConf | null {
  try {
    const dir = join(homedir(), '.cc-switch')
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      currentProviderClaude?: string
    }
    const db = new DatabaseSync(join(dir, 'cc-switch.db'), { readOnly: true })
    type Row = { name: string; settings_config: string }
    const row = (
      settings.currentProviderClaude
        ? db
            .prepare("SELECT name, settings_config FROM providers WHERE id = ? AND app_type = 'claude'")
            .get(settings.currentProviderClaude)
        : db
            .prepare("SELECT name, settings_config FROM providers WHERE app_type = 'claude' AND is_current = 1")
            .get()
    ) as Row | undefined
    db.close()
    if (!row) return null
    const env =
      (JSON.parse(row.settings_config) as { env?: Record<string, string> }).env ?? {}
    if (!env.ANTHROPIC_AUTH_TOKEN || !env.ANTHROPIC_BASE_URL) return null
    return {
      token: env.ANTHROPIC_AUTH_TOKEN,
      baseURL: env.ANTHROPIC_BASE_URL,
      model: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '',
      name: row.name,
    }
  } catch {
    return null
  }
}

export default defineConfig(({ command, mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, '')
  const dev = command === 'serve'
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.DEV_DEEPSEEK_KEY': JSON.stringify(
        dev ? (rootEnv.DEEPSEEK_API_KEY ?? '') : '',
      ),
      'import.meta.env.DEV_CC_SWITCH': JSON.stringify(dev ? readCcSwitch() : null),
    },
  }
})
