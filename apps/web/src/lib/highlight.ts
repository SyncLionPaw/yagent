import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const HLJS_LANGS: [string, typeof bash, ...string[]][] = [
  ['bash', bash, 'sh', 'shell', 'zsh', 'console', 'terminal'],
  ['c', c],
  ['cpp', cpp, 'c++'],
  ['css', css],
  ['diff', diff, 'patch'],
  ['go', go, 'golang'],
  ['java', java],
  ['javascript', javascript, 'js', 'jsx'],
  ['json', json],
  ['markdown', markdown, 'md'],
  ['python', python, 'py'],
  ['rust', rust, 'rs'],
  ['sql', sql],
  ['typescript', typescript, 'ts', 'tsx'],
  ['xml', xml, 'html', 'htm', 'svg'],
  ['yaml', yaml, 'yml'],
]

let registered = false

function ensureRegistered(): void {
  if (registered) return
  for (const [name, def, ...aliases] of HLJS_LANGS) {
    hljs.registerLanguage(name, def)
    for (const a of aliases) hljs.registerLanguage(a, def)
  }
  registered = true
}

/** 按语言 id 高亮；未知语言返回 null */
export function highlightCode(code: string, lang?: string | null): string | null {
  if (!lang) return null
  ensureRegistered()
  const id = lang.toLowerCase()
  if (!hljs.getLanguage(id)) return null
  try {
    return hljs.highlight(code, { language: id, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

const EXT_LANG: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cmake: 'bash',
  cpp: 'cpp',
  cxx: 'cpp',
  css: 'css',
  diff: 'diff',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'xml',
  html: 'xml',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mjs: 'javascript',
  patch: 'diff',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  toml: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

/** 文件名 → highlight.js 语言；无法识别返回 null */
export function langFromFilename(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot < 0) {
    const lower = base.toLowerCase()
    if (lower === 'dockerfile' || lower === 'makefile') return 'bash'
    return null
  }
  return EXT_LANG[base.slice(dot + 1).toLowerCase()] ?? null
}
