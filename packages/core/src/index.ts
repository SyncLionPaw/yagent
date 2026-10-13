export const APP_NAME = 'yagent'

export interface AgentConfig {
  id: string
  name: string
  model: string
  createdAt: string
}

export interface ApiClientOptions {
  baseUrl: string
  headers?: Record<string, string>
}

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${options.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...options.headers, ...init?.headers },
    })
    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  }
}
