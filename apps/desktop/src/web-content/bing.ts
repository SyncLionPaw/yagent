import type { WebContentProvider } from './types'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 现有实现：抓 Bing HTML 解析结果 + 直连 URL 粗去标签 */
export function createBingWebProvider(): WebContentProvider {
  return {
    id: 'bing',

    async search(query, signal) {
      const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
        signal: signal ?? AbortSignal.timeout(15_000),
        headers: { 'user-agent': UA },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      const results: string[] = []
      const itemRe =
        /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/g
      let m: RegExpExecArray | null
      while ((m = itemRe.exec(html)) && results.length < 10) {
        const snip = m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/)
        results.push(
          `${results.length + 1}. ${stripHtml(m[2])}\n   ${m[1]}\n   ${snip ? stripHtml(snip[1]) : ''}`,
        )
      }
      return results.length ? results.join('\n') : 'No results found.'
    },

    async fetch(url, signal) {
      if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs are allowed')
      const res = await fetch(url, {
        signal: signal ?? AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'yagent/0.1 (+https://localhost)' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return stripHtml(await res.text())
    },
  }
}
