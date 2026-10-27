import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  hasWebSpeechRecognition,
  isElectronShell,
  pickRecorderMime,
  transcribeWithWhisper,
  type WhisperAuth,
} from '../lib/speech'

interface VoiceOverlayProps {
  open: boolean
  /** OpenAI Whisper；缺省时 Electron 无法识别，仅 Chrome 可走 Web Speech */
  whisper: WhisperAuth | null
  onCancel: () => void
  onConfirm: (text: string) => void
}

const BAR_COUNT = 48
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

interface SpeechResult {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechResultList {
  length: number
  [index: number]: SpeechResult
}
type SpeechRecognitionCtor = new () => {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type Phase = 'boot' | 'listening' | 'transcribing' | 'error'

/**
 * 语音录入：真实麦克风频谱 + 识别。
 * - Chrome：优先 Web Speech（实时字幕）
 * - Electron：Web Speech 不可用，录音后用 Whisper（需 OpenAI Key）
 * - 不再注入演示假文案
 */
export function VoiceOverlay({ open, whisper, onCancel, onConfirm }: VoiceOverlayProps) {
  const [text, setText] = useState('')
  const [sec, setSec] = useState(0)
  const [phase, setPhase] = useState<Phase>('boot')
  const [hint, setHint] = useState('')
  const waveRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const textRef = useRef('')
  const whisperRef = useRef(whisper)
  whisperRef.current = whisper
  const cleanupRef = useRef<() => void>(() => {})
  const stopRecorderRef = useRef<() => Promise<Blob | null>>(async () => null)
  const webSpeechOkRef = useRef(false)
  const abortWhisperRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open || startedRef.current) return
    startedRef.current = true
    setText('')
    setSec(0)
    setPhase('boot')
    setHint('正在打开麦克风…')
    textRef.current = ''
    webSpeechOkRef.current = false

    const bars = waveRef.current
      ? Array.from(waveRef.current.querySelectorAll<HTMLElement>('i'))
      : []
    let rafId = 0
    let mediaStream: MediaStream | null = null
    let audioCtx: AudioContext | null = null
    let recog: InstanceType<SpeechRecognitionCtor> | null = null
    let recorder: MediaRecorder | null = null
    const chunks: Blob[] = []

    const vTimer = setInterval(() => setSec((s) => s + 1), 1000)

    const setTranscript = (t: string) => {
      textRef.current = t
      setText(t)
    }

    const startWave = (stream: MediaStream) => {
      audioCtx = new AudioContext()
      const src = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.72
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      bars.forEach((b) => {
        b.style.animation = 'none'
      })
      const tick = () => {
        analyser.getByteFrequencyData(data)
        let sum = 0
        bars.forEach((b, i) => {
          const v = data[Math.floor((i * data.length) / bars.length)] / 255
          sum += v
          b.style.height = 10 + v * 66 + '%'
        })
        const vol = sum / bars.length
        if (waveRef.current) waveRef.current.style.transform = `scaleY(${1 + vol * 0.18})`
        rafId = requestAnimationFrame(tick)
      }
      tick()
    }

    const startWebSpeech = (): boolean => {
      // Electron 内置 Chromium 无 Google 语音服务，会 network 失败 → 跳过
      if (isElectronShell()) return false
      if (!hasWebSpeechRecognition()) return false
      const w = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor
        webkitSpeechRecognition?: SpeechRecognitionCtor
      }
      const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
      if (!SR) return false
      recog = new SR()
      recog.lang = 'zh-CN'
      recog.continuous = true
      recog.interimResults = true
      let finalText = ''
      recog.onresult = (e) => {
        webSpeechOkRef.current = true
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript
          else interim += e.results[i][0].transcript
        }
        setTranscript(finalText + interim)
        setHint('')
      }
      recog.onerror = (e) => {
        if (e.error === 'aborted' || e.error === 'no-speech') return
        // 失败则继续靠录音 + Whisper，不灌假字
        try {
          recog?.stop()
        } catch {
          //
        }
        recog = null
        if (!whisperRef.current) {
          setPhase('error')
          setHint(`浏览器语音识别失败（${e.error}）。可配置 OpenAI Key 改用 Whisper。`)
        } else {
          setHint('浏览器识别不可用，将在完成后用 Whisper 转写')
        }
      }
      recog.onend = () => {
        // continuous 下意外结束时尝试重启
        if (!startedRef.current || !recog) return
        try {
          recog.start()
        } catch {
          //
        }
      }
      try {
        recog.start()
        return true
      } catch {
        return false
      }
    }

    const startRecorder = (stream: MediaStream) => {
      const mime = pickRecorderMime()
      if (!mime || typeof MediaRecorder === 'undefined') return
      try {
        recorder = new MediaRecorder(stream, { mimeType: mime })
      } catch {
        try {
          recorder = new MediaRecorder(stream)
        } catch {
          return
        }
      }
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data)
      }
      recorder.start(1000)
    }

    stopRecorderRef.current = () =>
      new Promise((resolve) => {
        if (!recorder || recorder.state === 'inactive') {
          resolve(chunks.length ? new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }) : null)
          return
        }
        recorder.onstop = () => {
          resolve(chunks.length ? new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }) : null)
        }
        try {
          recorder.stop()
        } catch {
          resolve(null)
        }
      })

    void (async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        setPhase('error')
        setHint('无法使用麦克风：请在系统设置中允许 yagent 访问麦克风')
        return
      }
      startWave(mediaStream)
      startRecorder(mediaStream)
      const webOk = startWebSpeech()
      setPhase('listening')
      if (webOk) {
        setHint('正在聆听…')
      } else if (whisperRef.current) {
        setHint('正在录音… 说完后点完成，将用 Whisper 识别')
      } else {
        setPhase('error')
        setHint(
          isElectronShell()
            ? '桌面端需配置 ASR：设置 → 工具 → 语音识别（推荐免费 Groq，或本地 SenseVoice）'
            : '请使用 Chrome，或在 设置 → 工具 → 语音识别 配置 Groq / 本地 ASR',
        )
      }
    })()

    cleanupRef.current = () => {
      clearInterval(vTimer)
      cancelAnimationFrame(rafId)
      abortWhisperRef.current?.abort()
      abortWhisperRef.current = null
      if (recog) {
        try {
          recog.onend = null
          recog.stop()
        } catch {
          //
        }
      }
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          //
        }
      }
      mediaStream?.getTracks().forEach((t) => t.stop())
      void audioCtx?.close().catch(() => {})
      bars.forEach((b) => {
        b.style.animation = ''
        b.style.height = ''
      })
      if (waveRef.current) waveRef.current.style.transform = ''
    }
  }, [open])

  useEffect(() => {
    if (open) return
    if (!startedRef.current) return
    startedRef.current = false
    cleanupRef.current()
  }, [open])

  const handleConfirm = () => {
    if (phase === 'transcribing') return
    void (async () => {
      // 已有 Web Speech 结果 → 直接回填
      if (textRef.current.trim()) {
        onConfirm(textRef.current.trim())
        return
      }
      const auth = whisperRef.current
      if (!auth) {
        setPhase('error')
        setHint('没有识别到文字。请在设置里配置 ASR（Groq / 本地），或换 Chrome')
        return
      }
      setPhase('transcribing')
      setHint('正在识别…')
      const blob = await stopRecorderRef.current()
      if (!blob || blob.size < 256) {
        setPhase('error')
        setHint('没有录到有效音频，请再说一次')
        return
      }
      const ac = new AbortController()
      abortWhisperRef.current = ac
      try {
        const out = await transcribeWithWhisper(blob, auth, ac.signal)
        if (!out) {
          setPhase('error')
          setHint('未识别到有效内容，请再说一次')
          return
        }
        textRef.current = out
        setText(out)
        onConfirm(out)
      } catch (err) {
        if (ac.signal.aborted) return
        setPhase('error')
        setHint(err instanceof Error ? err.message : String(err))
      } finally {
        abortWhisperRef.current = null
      }
    })()
  }

  const busy = phase === 'transcribing'

  return (
    <div className={`voice-overlay${open ? ' open' : ''}`}>
      <div className="voice-wave" ref={waveRef}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <i key={i}></i>
        ))}
      </div>
      <div className="v-meta">
        <span className={`rec-dot${phase === 'error' ? ' off' : ''}`}></span>
        <span className="vtime">{fmt(sec)}</span>
      </div>
      <div className="voice-text">
        <span>{text || hint}</span>
        {phase === 'listening' && <span className="caret"></span>}
      </div>
      {text && hint && phase !== 'listening' && <div className="voice-hint">{hint}</div>}
      {!text && phase === 'error' && <div className="voice-hint">可点取消关闭</div>}
      <div className="voice-actions">
        <button className="v-btn v-cancel" title="取消" onClick={onCancel} disabled={busy}>
          <X className="ic ic-sm" />
        </button>
        <button
          className="v-btn v-confirm"
          title="完成"
          onClick={handleConfirm}
          disabled={busy || phase === 'boot' || (phase === 'error' && !whisper)}
        >
          <Check className="ic ic-sm" />
        </button>
      </div>
    </div>
  )
}
