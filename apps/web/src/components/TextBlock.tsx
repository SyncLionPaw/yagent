import { isValidElement, memo, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import hljs from 'highlight.js/lib/core'
import katex from 'katex'
import { materializeRefs, type Ref } from '@yagent/core'
import { Check, Copy, WrapText } from 'lucide-react'
import 'katex/dist/katex.min.css'

// 按需注册高亮语言（避免全量 bundle）；别名一并 register
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
  ['xml', xml, 'html', 'svg'],
  ['yaml', yaml, 'yml'],
]

for (const [name, def, ...aliases] of HLJS_LANGS) {
  hljs.registerLanguage(name, def)
  for (const a of aliases) hljs.registerLanguage(a, def)
}

function highlightCode(code: string, lang?: string): string | null {
  if (!lang) return null
  const id = lang.toLowerCase()
  if (!hljs.getLanguage(id)) return null
  try {
    return hljs.highlight(code, { language: id, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

interface TextBlockProps {
  text: string
  /** 会话已汇总的来源（用于稳定编号）；缺省则只按本文标签编号 */
  refs?: Ref[]
  onRefClick?: (id: number) => void
}

/**
 * 渲染 agent 正文：react-markdown + GFM + KaTeX 公式（可切原始 TeX）+ 高亮代码块（折行/复制）。
 * `<ref>` / `<ref_link>` → `[n]`；再把 `[n]` 改成内部链接角标（点击联动右栏）。
 *
 * 流式性能：正文按"围栏代码块之外的空行"切成块，每块一个 memo 的 Markdown 实例——
 * 流式只有最后一块在变，前面的块跳过解析。
 */
export function TextBlock({ text, refs, onRefClick }: TextBlockProps) {
  const display = useMemo(() => materializeRefs(text, refs ?? []).text, [text, refs])
  const blocks = useMemo(() => splitBlocks(preprocess(display)), [display])
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <MdBlock key={i} source={b} onRefClick={onRefClick} />
      ))}
    </div>
  )
}

const MdBlock = memo(function MdBlock({
  source,
  onRefClick,
}: {
  source: string
  onRefClick?: (id: number) => void
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      components={{
        a({ href, children }) {
          const m = /^#ref-(\d+)$/.exec(href ?? '')
          if (m) {
            const id = Number(m[1])
            return (
              <a className="ref" onClick={() => onRefClick?.(id)}>
                {children}
              </a>
            )
          }
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        },
        pre: CodeBlockOrMath,
        code: InlineCode,
      }}
    >
      {source}
    </Markdown>
  )
})

/* ---------- 代码块 / 块级公式（pre 入口） ---------- */

/** pre 只有一个 code 子元素：math-display → 公式；否则 → 带头部的代码块 */
function CodeBlockOrMath({ children }: { children?: ReactNode }) {
  const codeEl = findCodeEl(children)
  const className = (codeEl?.props as { className?: string } | undefined)?.className ?? ''
  if (/math-display/.test(className)) {
    const tex = extractText((codeEl?.props as { children?: ReactNode } | undefined)?.children)
    return <MathTex tex={tex} display />
  }
  return <CodeBlock className={className}>{children}</CodeBlock>
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  // className 可能是 string 或 hast 留下的数组
  const cls = Array.isArray(className) ? className.join(' ') : (className ?? '')
  const lang = /(?:language|lang)-([\w+#]+)/.exec(cls)?.[1]
  const raw = extractText(children).replace(/\n$/, '')
  const highlighted = useMemo(() => highlightCode(raw, lang), [raw, lang])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
    } catch {
      // 剪贴板不可用时仍给出视觉反馈
    }
    setCopied(true)
  }

  return (
    <div className={`codeblock${wrap ? ' wrap' : ''}`}>
      <div className="cb-head">
        <span className="cb-lang">{lang ?? 'code'}</span>
        <button
          className={`icon-btn${wrap ? ' on' : ''}`}
          title={wrap ? '取消折行' : '自动折行'}
          onClick={() => setWrap((v) => !v)}
        >
          <WrapText className="ic ic-sm" />
        </button>
        <button className={`icon-btn${copied ? ' copied' : ''}`} title="复制代码" onClick={copy}>
          {copied ? <Check className="ic ic-sm" /> : <Copy className="ic ic-sm" />}
        </button>
      </div>
      <pre>
        {highlighted ? (
          <code
            className={`hljs${lang ? ` language-${lang}` : ''}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code className={lang ? `language-${lang}` : undefined}>{raw}</code>
        )}
      </pre>
    </div>
  )
}

/* ---------- 公式（katex 直接渲染，可复制 / 切原始 TeX） ---------- */

function MathTex({ tex, display }: { tex: string; display: boolean }) {
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  const html = useMemo(() => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, strict: false })
    } catch {
      return null
    }
  }, [tex, display])

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(tex.trim())
    } catch {
      // 剪贴板不可用时仍给出视觉反馈
    }
    setCopied(true)
  }

  if (!display) {
    // 行内：点击公式切 TeX 源码；源码态再点返回
    if (raw) {
      return (
        <code className="math-raw" title="点击返回渲染视图" onClick={() => setRaw(false)}>
          {tex.trim()}
        </code>
      )
    }
    if (!html) return <code>{tex}</code>
    return (
      <span
        className="math-inline"
        title="点击查看 TeX 源码"
        onClick={() => setRaw(true)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  // 块级：右上角工具组（复制 TeX / 切换视图），两种视图下都可用
  return (
    <div className="math-block">
      <div className="math-tools">
        <button className={`math-btn${copied ? ' copied' : ''}`} title="复制 TeX" onClick={copy}>
          {copied ? <Check className="ic ic-sm" /> : <Copy className="ic ic-sm" />}
        </button>
        <button
          className="math-btn math-toggle"
          title={raw ? '返回渲染视图' : '查看 TeX 源码'}
          onClick={() => setRaw((v) => !v)}
        >
          {raw ? 'Fx' : 'TeX'}
        </button>
      </div>
      {raw ? (
        <pre className="math-raw">{tex.trim()}</pre>
      ) : html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{tex}</code>
      )}
    </div>
  )
}

/* ---------- 行内 code / 行内公式 ---------- */

function InlineCode({ className, children }: { className?: string; children?: ReactNode }) {
  if (className && /math-(inline|display)/.test(className)) {
    return <MathTex tex={extractText(children)} display={/math-display/.test(className)} />
  }
  return <code className={className}>{children}</code>
}

/* ---------- helpers ---------- */

/** pre 的子元素里找 code（hast 结构固定，但宽容处理数组/空） */
function findCodeEl(children: ReactNode): ReactElement | null {
  if (isValidElement(children)) return children
  if (Array.isArray(children)) return children.find(isValidElement) ?? null
  return null
}

/** 递归取文本（高亮后的 code children 是 span 树，复制/TeX 源码需要原始串） */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children)
  }
  return ''
}

/* ---------- 预处理 ---------- */

/** 跳过围栏 / 行内代码块：$$ 规整为块级公式 + [n] 角标改写成内部链接 */
function preprocess(md: string): string {
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : transformChunk(part)))
    .join('')
}

/** 按"围栏代码块之外的空行"切块；未闭合的围栏（流式中）一直吃到结尾 */
function splitBlocks(md: string): string[] {
  const blocks: string[] = []
  let cur: string[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      cur.push(line)
      inFence = !inFence
      continue
    }
    if (!inFence && line.trim() === '') {
      if (cur.length) blocks.push(cur.join('\n'))
      cur = []
      continue
    }
    cur.push(line)
  }
  if (cur.length) blocks.push(cur.join('\n'))
  return blocks
}

function transformChunk(part: string): string {
  // 模型常输出 LaTeX 原生分隔符 \[...\] / \(...\)，remark-math 只认 $$ / $，先转换
  let out = part.replace(/\\\[([\s\S]*?)\\\]/g, (m, inner: string) =>
    inner.trim() ? `\n\n$$\n${inner.trim()}\n$$\n\n` : m,
  )
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (m, inner: string) =>
    inner.trim() ? `$${inner.trim()}$` : m,
  )
  out = normalizeDisplayMath(out)
  return out.replace(/(?<!!)\[(\d+)\](?!\()/g, '[$1](#ref-$1)')
}

/**
 * 单行 $$..$$ → 规整为独占多行的块级公式（remark-math 只认多行形式）。
 * 手动扫描而非正则配对：配对失败时只跳过 opening，不误吞后面的真正公式；
 * 内容不含公式特征（\ = ^ _ { }）的 "$$" 视为正文，不动。
 */
function normalizeDisplayMath(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const open = s.indexOf('$$', i)
    if (open === -1) return out + s.slice(i)
    const close = s.indexOf('$$', open + 2)
    if (close === -1) return out + s.slice(i)
    const inner = s.slice(open + 2, close)
    if (inner.trim() && !inner.includes('\n') && /[\\=^_{}]/.test(inner)) {
      out += s.slice(i, open) + `\n\n$$\n${inner.trim()}\n$$\n\n`
      i = close + 2
    } else {
      out += s.slice(i, open + 2)
      i = open + 2
    }
  }
  return out
}
