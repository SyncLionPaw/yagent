import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'

interface VoiceOverlayProps {
  open: boolean
  onCancel: () => void
  onConfirm: (text: string) => void
}

const BAR_COUNT = 48
const DEMO_TRANSCRIPT = '把登录页加上"记住我"复选框，默认勾选，然后帮我把登录流程跑一遍测试'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// TS DOM lib 不含 SpeechRecognition，定义最小结构
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
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

/**
 * 语音录入悬浮层：覆盖整个舞台。
 * 真实驱动：getUserMedia + AnalyserNode 频谱柱 + SpeechRecognition 识别；
 * 无权限/不支持时回退 CSS 模拟动画 + 演示文本。
 */
export function VoiceOverlay({ open, onCancel, onConfirm }: VoiceOverlayProps) {
  const [text, setText] = useState('')
  const [sec, setSec] = useState(0)
  const waveRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const textRef = useRef('')
  const cleanupRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!open || startedRef.current) return
    startedRef.current = true
    setText('')
    setSec(0)
    textRef.current = ''

    const bars = waveRef.current
      ? Array.from(waveRef.current.querySelectorAll<HTMLElement>('i'))
      : []
    let rafId = 0
    let mediaStream: MediaStream | null = null
    let audioCtx: AudioContext | null = null
    let recog: InstanceType<SpeechRecognitionCtor> | null = null

    const vTimer = setInterval(() => setSec((s) => s + 1), 1000)
    let tTimer: ReturnType<typeof setInterval> | undefined

    // 真实麦克风频谱：rAF 每帧将频率 bins 映射到柱高（10%–76%），容器随音量呼吸
    const startRealAudio = async () => {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioCtx = new AudioContext()
      const src = audioCtx.createMediaStreamSource(mediaStream)
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

    const startRealRecognition = (): boolean => {
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
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript
          else interim += e.results[i][0].transcript
        }
        textRef.current = finalText + interim
        setText(textRef.current)
      }
      recog.onerror = () => {}
      try {
        recog.start()
        return true
      } catch {
        return false
      }
    }

    const startSimulatedTranscript = () => {
      let i = 0
      tTimer = setInterval(() => {
        if (i >= DEMO_TRANSCRIPT.length) {
          clearInterval(tTimer)
          return
        }
        textRef.current += DEMO_TRANSCRIPT[i++]
        setText(textRef.current)
      }, 110)
    }

    // 无权限/不支持时回退到模拟演示
    startRealAudio().catch(() => {})
    if (!startRealRecognition()) startSimulatedTranscript()

    cleanupRef.current = () => {
      clearInterval(vTimer)
      if (tTimer) clearInterval(tTimer)
      cancelAnimationFrame(rafId)
      if (recog) {
        try {
          recog.stop()
        } catch {
          // 已停止
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
    const t = textRef.current
    onConfirm(t.trim() ? t : '')
  }

  return (
    <div className={`voice-overlay${open ? ' open' : ''}`}>
      <div className="voice-wave" ref={waveRef}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <i key={i}></i>
        ))}
      </div>
      <div className="v-meta">
        <span className="rec-dot"></span>
        <span className="vtime">{fmt(sec)}</span>
      </div>
      <div className="voice-text">
        <span>{text}</span>
        <span className="caret"></span>
      </div>
      <div className="voice-actions">
        <button className="v-btn v-cancel" title="取消" onClick={onCancel}>
          <X className="ic ic-sm" />
        </button>
        <button className="v-btn v-confirm" title="完成" onClick={handleConfirm}>
          <Check className="ic ic-sm" />
        </button>
      </div>
    </div>
  )
}
