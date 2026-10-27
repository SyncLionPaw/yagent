/** search_web / fetch_url 的可替换后端（主进程执行） */

export type WebContentProviderId = 'bing' | 'deepseek'

export interface WebContentProvider {
  readonly id: WebContentProviderId
  search(query: string, signal?: AbortSignal): Promise<string>
  fetch(url: string, signal?: AbortSignal): Promise<string>
}

export interface WebContentResolveInput {
  provider?: WebContentProviderId | string | null
  /** DeepSeek 用：从 settings.models 里挑到的 apiKey */
  deepseekApiKey?: string | null
  deepseekBaseURL?: string | null
}
