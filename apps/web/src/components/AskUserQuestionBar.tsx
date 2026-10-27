import { useMemo, useRef, useState } from 'react'
import { Check, HelpCircle, X } from 'lucide-react'
import type { AskQuestion, AskUserAnswers, AskUserRequest } from '../askUserQuestion'

const OTHER = '其他'

type Props = {
  req: AskUserRequest
  onSubmit: (answers: AskUserAnswers) => void
  onCancel: () => void
}

type QState = {
  selected: string[]
  /** 非空表示选用「其他」 */
  otherText: string
}

function initState(questions: AskQuestion[]): QState[] {
  return questions.map(() => ({ selected: [], otherText: '' }))
}

function answerOf(q: AskQuestion, st: QState): string | null {
  const other = st.otherText.trim()
  if (q.multiSelect) {
    const parts = [...st.selected]
    if (other) parts.push(other)
    return parts.length ? parts.join(', ') : null
  }
  if (other) return other
  return st.selected[0] ?? null
}

export function AskUserQuestionBar({ req, onSubmit, onCancel }: Props) {
  const [states, setStates] = useState(() => initState(req.questions))
  const otherInputs = useRef<(HTMLInputElement | null)[]>([])

  const ready = useMemo(() => {
    return req.questions.every((q, i) => answerOf(q, states[i]!) != null)
  }, [req.questions, states])

  const clearOtherInput = (qi: number) => {
    const el = otherInputs.current[qi]
    if (el) el.value = ''
  }

  const toggle = (qi: number, label: string) => {
    const q = req.questions[qi]!
    setStates((prev) => {
      const next = prev.map((s) => ({ ...s, selected: [...s.selected] }))
      const st = next[qi]!
      if (q.multiSelect) {
        const at = st.selected.indexOf(label)
        if (at >= 0) st.selected.splice(at, 1)
        else st.selected.push(label)
      } else {
        st.selected = [label]
        st.otherText = ''
        clearOtherInput(qi)
      }
      return next
    })
  }

  const onOtherInput = (qi: number, text: string) => {
    const q = req.questions[qi]!
    setStates((prev) => {
      const next = prev.map((s) => ({ ...s, selected: [...s.selected] }))
      const st = next[qi]!
      st.otherText = text
      if (!q.multiSelect && text.trim()) st.selected = []
      return next
    })
  }

  const submit = () => {
    if (!ready) return
    const answers: AskUserAnswers = {}
    req.questions.forEach((q, i) => {
      answers[q.question] = answerOf(q, states[i]!)!
    })
    onSubmit(answers)
  }

  return (
    <div className="ask-bar" role="form" aria-label="向你提问" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ask-bar-head">
        <HelpCircle className="ic ask-bar-icon" />
        <span className="ask-bar-title">需要你的选择</span>
        <span className="ask-bar-actions">
          <button type="button" className="ab-btn ab-deny" title="跳过" aria-label="跳过" onClick={onCancel}>
            <X className="ic" />
          </button>
          <button
            type="button"
            className="ab-btn ab-allow"
            title="提交"
            aria-label="提交"
            disabled={!ready}
            onClick={submit}
          >
            <Check className="ic" />
          </button>
        </span>
      </div>
      <div className="ask-bar-list">
        {req.questions.map((q, qi) => {
          const st = states[qi]!
          const otherOn = st.otherText.trim().length > 0
          return (
            <div key={q.question} className="ask-q">
              <div className="ask-q-head">
                <span className="ask-q-chip">{q.header}</span>
                <span className="ask-q-text">{q.question}</span>
                {q.multiSelect ? <span className="ask-q-hint">可多选</span> : null}
              </div>
              <div className={`ask-opts ask-opts-${Math.min(q.options.length, 4)}`} role="group">
                {q.options.map((opt) => {
                  const on = st.selected.includes(opt.label) && !( !q.multiSelect && otherOn)
                  const desc = opt.description && opt.description !== opt.label ? opt.description : ''
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      className={`ask-opt${on ? ' on' : ''}`}
                      title={desc || opt.label}
                      aria-pressed={on}
                      onClick={() => toggle(qi, opt.label)}
                    >
                      <span className="ask-opt-label">{opt.label}</span>
                      <span className="ask-opt-desc">{desc || '\u00a0'}</span>
                    </button>
                  )
                })}
              </div>
              <div className={`ask-other-row${otherOn ? ' on' : ''}`}>
                <span className="ask-other-tag">{OTHER}</span>
                <input
                  ref={(el) => {
                    otherInputs.current[qi] = el
                  }}
                  className="ask-other-inline"
                  type="text"
                  defaultValue=""
                  placeholder="在这里输入…"
                  aria-label="其他答案"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      e.currentTarget.value = ''
                      onOtherInput(qi, '')
                      e.currentTarget.blur()
                      return
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const text = e.currentTarget.value
                      const nextStates = states.map((s, i) =>
                        i === qi
                          ? {
                              selected: q.multiSelect ? s.selected : [],
                              otherText: text,
                            }
                          : s,
                      )
                      if (!req.questions.every((qq, i) => answerOf(qq, nextStates[i]!) != null)) {
                        onOtherInput(qi, text)
                        return
                      }
                      const answers: AskUserAnswers = {}
                      req.questions.forEach((qq, i) => {
                        answers[qq.question] = answerOf(qq, nextStates[i]!)!
                      })
                      onSubmit(answers)
                    }
                  }}
                  onInput={(e) => onOtherInput(qi, e.currentTarget.value)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
