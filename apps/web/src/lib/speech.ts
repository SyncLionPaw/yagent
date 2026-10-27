import type { ModelConfig, Settings } from '@yagent/core'
import { cleanKey, effectiveKey } from '../harness'

export type AsrProviderId = 'groq' | 'openai' | 'custom'

export interface WhisperAuth {
  apiKey: string
  baseURL: string
  /** OpenAI: whisper-1；Groq: whisper-large-v3-turbo；FunASR: sensevoice */
  model: string
  label: string
}

const GROQ_BASE = 'https://api.groq.com/openai'
const OPENAI_BASE = 'https://api.openai.com'

/** 从设置解析 ASR；DeepSeek 无语音接口，不参与 */
export function resolveWhisperAuth(settings: Settings): WhisperAuth | null {
  const asr = settings.tools.asr
  const provider = asr?.provider

  if (provider === 'groq') {
    const key = cleanKey(asr?.apiKey)
    if (!key) return null
    return {
      apiKey: key,
      baseURL: GROQ_BASE,
      model: asr?.model?.trim() || 'whisper-large-v3-turbo',
      label: 'Groq Whisper',
    }
  }

  if (provider === 'custom') {
    const base = cleanKey(asr?.baseURL).replace(/\/+$/, '')
    if (!base) return null
    return {
      apiKey: cleanKey(asr?.apiKey) || 'not-needed',
      baseURL: base,
      model: asr?.model?.trim() || 'sensevoice',
      label: '本地 / 自定义 ASR',
    }
  }

  if (provider === 'openai') {
    const fromAsr = cleanKey(asr?.apiKey)
    const fromModel = pickOpenAIKey(settings.models)
    const key = fromAsr || fromModel
    if (!key) return null
    return {
      apiKey: key,
      baseURL: OPENAI_BASE,
      model: asr?.model?.trim() || 'whisper-1',
      label: 'OpenAI Whisper',
    }
  }

  // 未显式选择：自动探测（Groq 设置 → OpenAI 模型 → 自定义 ASR URL）
  const groqKey = cleanKey(asr?.apiKey)
  if (asr?.provider === undefined && groqKey && !asr?.baseURL) {
    // 若只填了 asr.apiKey 但没选 provider，不瞎猜；走下面模型探测
  }

  const openaiKey = pickOpenAIKey(settings.models)
  if (openaiKey) {
    return {
      apiKey: openaiKey,
      baseURL: OPENAI_BASE,
      model: 'whisper-1',
      label: 'OpenAI Whisper',
    }
  }

  const customModel = settings.models.find(
    (m) => m.provider === 'custom' && effectiveKey(m) && cleanKey(m.baseURL),
  )
  if (customModel) {
    return {
      apiKey: effectiveKey(customModel),
      baseURL: cleanKey(customModel.baseURL).replace(/\/+$/, ''),
      model: 'whisper-1',
      label: '自定义端点',
    }
  }

  return null
}

function pickOpenAIKey(models: ModelConfig[]): string {
  const m = models.find((x) => x.provider === 'openai' && effectiveKey(x))
  return m ? effectiveKey(m) : ''
}

export function hasWebSpeechRecognition(): boolean {
  const w = window as unknown as {
    SpeechRecognition?: unknown
    webkitSpeechRecognition?: unknown
  }
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

export function isElectronShell(): boolean {
  return !!window.yagentDesktop
}

/** OpenAI 兼容 POST /v1/audio/transcriptions（Groq / OpenAI / FunASR 本地服务） */
export async function transcribeWithWhisper(
  blob: Blob,
  auth: WhisperAuth,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData()
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('file', blob, `audio.${ext}`)
  form.append('model', auth.model)
  form.append('language', 'zh')

  const base = auth.baseURL.replace(/\/+$/, '')
  // 兼容用户填 …/v1 或根域名
  const url = base.endsWith('/v1') ? `${base}/audio/transcriptions` : `${base}/v1/audio/transcriptions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.apiKey}` },
    body: form,
    signal,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      detail = j.error?.message ?? ''
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 200)
    }
    throw new Error(detail || `ASR HTTP ${res.status}`)
  }
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

export function pickRecorderMime(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  if (typeof MediaRecorder === 'undefined') return undefined
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}
