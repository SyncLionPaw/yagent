/** 输入框粘贴 / 拖放附件白名单（面向编程 Agent 场景） */

const ACCEPT_EXT = new Set([
  // 图片 / 截图
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  // 文档
  'pdf',
  'md',
  'markdown',
  'txt',
  'rst',
  'rtf',
  // 网页
  'html',
  'htm',
  'css',
  'scss',
  'less',
  // 代码
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hpp',
  'cs',
  'rb',
  'php',
  'swift',
  'vue',
  'svelte',
  'astro',
  'sql',
  'graphql',
  'gql',
  // 配置 / 数据
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'xml',
  'csv',
  'tsv',
  'ini',
  'cfg',
  'conf',
  // shell
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  // notebook / 压缩包（小体积参考资料）
  'ipynb',
  'zip',
  'tar',
  'gz',
  'tgz',
])

const ACCEPT_NAMES = new Set(['dockerfile', 'makefile', 'gemfile', 'procfile', 'cmakelists.txt'])

const ACCEPT_MIME_PREFIX = ['image/']
const ACCEPT_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/html',
  'text/css',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
])

export const MAX_ATTACH_BYTES = 20 * 1024 * 1024

/** 无扩展名但常见的源文件名，或扩展名 / MIME 命中白名单 */
export function isAcceptedAttach(file: File): boolean {
  const raw = file.name.trim()
  const lower = raw.toLowerCase()
  const base = lower.split(/[/\\]/).pop() ?? lower

  if (ACCEPT_NAMES.has(base)) return true
  if (base.startsWith('dockerfile')) return true

  const dot = base.lastIndexOf('.')
  if (dot > 0) {
    const ext = base.slice(dot + 1)
    if (ACCEPT_EXT.has(ext)) return true
  }

  if (ACCEPT_MIME.has(file.type)) return true
  if (ACCEPT_MIME_PREFIX.some((p) => file.type.startsWith(p))) return true
  return false
}

export function acceptAttachReason(file: File): 'ok' | 'type' | 'size' {
  if (file.size > MAX_ATTACH_BYTES) return 'size'
  if (!isAcceptedAttach(file)) return 'type'
  return 'ok'
}
