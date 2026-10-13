/* ============ SSE：fetch ReadableStream → 按 data: 行解析 ============ */

export interface SSEMessage {
  event?: string
  data: string
}

/**
 * POST + SSE 请求。HTTP 非 2xx 时读出响应体拼进 Error.message 后抛出。
 */
export async function postSSE(
  url: string,
  init: { headers: Record<string, string>; body: unknown; signal?: AbortSignal },
): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: JSON.stringify(init.body),
    signal: init.signal,
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      // 忽略读体失败
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 2000)}` : ''}`)
  }
  return res
}

/**
 * 把 Response body 按 SSE 协议切成 { event, data } 序列。
 * 兼容 \n / \r\n 换行；`: 开头`的注释行（心跳）被丢弃；signal 中断时干净结束。
 */
export async function* parseSSE(res: Response, signal?: AbortSignal): AsyncGenerator<SSEMessage> {
  if (!res.body) throw new Error('SSE response has no body')
  const reader = res.body.getReader()
  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let boundary = findBoundary(buf)
      while (boundary) {
        const raw = buf.slice(0, boundary.idx)
        buf = buf.slice(boundary.idx + boundary.len)
        const msg = parseEvent(raw)
        if (msg) yield msg
        boundary = findBoundary(buf)
      }
    }
    // 尾部没有空行分隔的残留事件也尝试吐出
    const tail = parseEvent(buf)
    if (tail) yield tail
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await reader.cancel().catch(() => undefined)
  }
}

function findBoundary(buf: string): { idx: number; len: number } | null {
  const lf = buf.indexOf('\n\n')
  const crlf = buf.indexOf('\r\n\r\n')
  if (lf === -1) return crlf === -1 ? null : { idx: crlf, len: 4 }
  if (crlf === -1) return { idx: lf, len: 2 }
  return crlf < lf ? { idx: crlf, len: 4 } : { idx: lf, len: 2 }
}

function parseEvent(raw: string): SSEMessage | null {
  const dataLines: string[] = []
  let event: string | undefined
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    else if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '')
  }
  if (dataLines.length === 0) return null
  const msg: SSEMessage = { data: dataLines.join('\n') }
  if (event !== undefined) msg.event = event
  return msg
}
