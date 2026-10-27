/* ============ ask_user_question：挂起等用户作答（输入框上方问答条） ============ */

export interface AskQuestionOption {
  label: string
  description: string
}

export interface AskQuestion {
  question: string
  header: string
  options: AskQuestionOption[]
  multiSelect: boolean
}

export interface AskUserRequest {
  questions: AskQuestion[]
}

/** question 原文 → 答案字符串（多选逗号分隔） */
export type AskUserAnswers = Record<string, string>

type AskHandler = (req: AskUserRequest, signal: AbortSignal) => Promise<AskUserAnswers>

let handler: AskHandler | null = null

export function registerAskUserHandler(h: AskHandler): void {
  handler = h
}

export function parseAskUserInput(input: Record<string, unknown>): AskUserRequest {
  const raw = input.questions
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('ask_user_question requires a non-empty questions array')
  }
  if (raw.length > 4) throw new Error('ask_user_question allows at most 4 questions')

  const questions: AskQuestion[] = raw.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`questions[${i}] must be an object`)
    const q = item as Record<string, unknown>
    const question = typeof q.question === 'string' ? q.question.trim() : ''
    const header = typeof q.header === 'string' ? q.header.trim() : ''
    if (!question) throw new Error(`questions[${i}].question is required`)
    if (!header) throw new Error(`questions[${i}].header is required`)
    if (header.length > 12) throw new Error(`questions[${i}].header must be ≤ 12 characters`)
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
      throw new Error(`questions[${i}].options must have 2–4 items`)
    }
    const options: AskQuestionOption[] = q.options.map((opt, j) => {
      if (!opt || typeof opt !== 'object') throw new Error(`questions[${i}].options[${j}] must be an object`)
      const o = opt as Record<string, unknown>
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      const description = typeof o.description === 'string' ? o.description.trim() : ''
      if (!label) throw new Error(`questions[${i}].options[${j}].label is required`)
      return { label, description: description || label }
    })
    const labels = options.map((o) => o.label)
    if (new Set(labels).size !== labels.length) {
      throw new Error(`questions[${i}].options labels must be unique`)
    }
    return {
      question,
      header,
      options,
      multiSelect: q.multiSelect === true,
    }
  })

  const texts = questions.map((q) => q.question)
  if (new Set(texts).size !== texts.length) {
    throw new Error('question texts must be unique')
  }

  return { questions }
}

export function formatAskUserResult(req: AskUserRequest, answers: AskUserAnswers): string {
  const lines = ['User answered:']
  for (const q of req.questions) {
    const a = answers[q.question]?.trim() || '(no answer)'
    lines.push(`- [${q.header}] ${q.question}`)
    lines.push(`  → ${a}`)
  }
  return lines.join('\n')
}

/** executor 调用：挂起等问答条；abort / 取消视为拒绝 */
export function requestAskUserQuestion(req: AskUserRequest, signal: AbortSignal): Promise<AskUserAnswers> {
  if (!handler) return Promise.reject(new Error('ask_user_question UI not available'))
  if (signal.aborted) return Promise.reject(new Error('aborted'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    void handler!(req, signal)
      .then((answers) => {
        signal.removeEventListener('abort', onAbort)
        resolve(answers)
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}
