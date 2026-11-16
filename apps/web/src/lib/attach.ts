/** 待发送附件：落盘 / 内联 / 预览相关工具 */

/** ≤1KB 的文本类文件直接塞进上下文 */
export const INLINE_ATTACH_MAX = 1024
/** 落盘失败时文本最多内联这么多，避免模型无路径可猜 */
export const INLINE_FALLBACK_MAX = 100_000

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function isImageAttach(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(file.name)
}

export function imageMimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  }
  return map[ext] ?? 'image/png'
}

export function isTextualAttach(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  if (file.type === 'application/json') return true
  return /\.(md|markdown|txt|csv|tsv|json|jsonc|ya?ml|toml|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|vue|svelte|sql|sh|bash|zsh|graphql|gql|ini|cfg|conf)$/i.test(
    file.name,
  )
}

/** 与 Composer 缩略卡对齐：html / md / 小 pdf 写入会话，便于气泡旁复用 */
export async function buildFilePreview(
  file: File,
  name: string,
): Promise<
  | { kind: 'html'; html: string }
  | { kind: 'md'; text: string }
  | { kind: 'pdf'; dataUrl: string }
  | undefined
> {
  const lower = name.toLowerCase()
  try {
    if (/\.html?$/.test(lower) || file.type === 'text/html') {
      return { kind: 'html', html: (await file.text()).slice(0, 80_000) }
    }
    if (/\.(md|markdown)$/.test(lower) || file.type === 'text/markdown') {
      return { kind: 'md', text: (await file.text()).slice(0, 12_000) }
    }
    if ((/\.pdf$/.test(lower) || file.type === 'application/pdf') && file.size <= 1.5 * 1024 * 1024) {
      return { kind: 'pdf', dataUrl: `data:application/pdf;base64,${await fileToBase64(file)}` }
    }
  } catch {
    // 预览失败不影响发送
  }
  return undefined
}

export function fenceLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    md: 'markdown',
    markdown: 'markdown',
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    html: 'html',
    htm: 'html',
    css: 'css',
    sh: 'bash',
    sql: 'sql',
  }
  return map[ext] ?? ext
}

export function formatAttachSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
