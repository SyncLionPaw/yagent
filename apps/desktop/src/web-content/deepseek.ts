import type { WebContentProvider } from './types'

const DEFAULT_BASE = 'https://api.deepseek.com'

interface SearchResult {
  title?: string
  url?: string
  snippet?: string
  summary?: string
  content?: string
  site_name?: string | null
  date?: string | null
  rerank_score?: number
  authority?: number
}

interface SearchResponse {
  results?: SearchResult[]
}

interface FetchResponse {
  title?: string
  content?: string
}

export interface DeepSeekWebProviderOptions {
  apiKey: string
  baseURL?: string
  /** 返回条数，默认 10 */
  count?: number
  /** 是否要正文 content；默认 false（summary 通常够给模型读） */
  needContent?: boolean
}

function formatApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (parsed.error?.message) return `DeepSeek ${status}: ${parsed.error.message}`
  } catch {
    //
  }
  return `DeepSeek HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`
}

/** DeepSeek Search / Fetch 官方工具 API（Bearer，与 Chat 同 key） */
export function createDeepSeekWebProvider(opts: DeepSeekWebProviderOptions): WebContentProvider {
  const base = (opts.baseURL ?? DEFAULT_BASE).replace(/\/+$/, '')
  const key = opts.apiKey.trim()
  if (!key) throw new Error('DeepSeek web provider requires an API key')

  const headers = {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }

  return {
    id: 'deepseek',

    async search(query, signal) {
      const q = query.trim()
      if (!q) throw new Error('query must not be empty')
      const res = await fetch(`${base}/v1/tools/search`, {
        method: 'POST',
        headers,
        signal: signal ?? AbortSignal.timeout(30_000),
        body: JSON.stringify({
          query: q.slice(0, 128),
          count: opts.count ?? 10,
          need_content: opts.needContent ?? false,
        }),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(formatApiError(res.status, text))
      const data = JSON.parse(text) as SearchResponse
      const results = data.results ?? []
      if (!results.length) return 'No results found.'
      return results
        .map((r, i) => {
          const body = (r.summary || r.snippet || r.content || '').trim()
          const meta = [
            r.site_name || null,
            r.date ? r.date.slice(0, 10) : null,
            typeof r.rerank_score === 'number' ? `score=${r.rerank_score}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
          return `${i + 1}. ${r.title ?? '(untitled)'}${meta ? ` (${meta})` : ''}\n   ${r.url ?? ''}\n   ${body}`
        })
        .join('\n')
    },

    async fetch(url, signal) {
      if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs are allowed')
      if (url.length > 8192) throw new Error('url too long')
      const res = await fetch(`${base}/v1/tools/fetch`, {
        method: 'POST',
        headers,
        signal: signal ?? AbortSignal.timeout(30_000),
        body: JSON.stringify({ url }),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(formatApiError(res.status, text))
      const data = JSON.parse(text) as FetchResponse
      const title = (data.title ?? '').trim()
      const content = (data.content ?? '').trim()
      if (!content) throw new Error('DeepSeek fetch returned empty content')
      return title ? `# ${title}\n\n${content}` : content
    },
  }
}
