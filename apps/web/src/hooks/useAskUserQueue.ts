import { useEffect, useState } from 'react'
import {
  registerAskUserHandler,
  type AskUserAnswers,
  type AskUserRequest,
} from '../askUserQuestion'

type AskItem = {
  id: number
  req: AskUserRequest
  resolve: (a: AskUserAnswers) => void
  reject: (e: Error) => void
}

/** ask_user_question 队列：abort / 提交 / 跳过都出队 */
export function useAskUserQueue() {
  const [askQueue, setAskQueue] = useState<AskItem[]>([])

  useEffect(() => {
    let seq = 0
    registerAskUserHandler((req, signal) => {
      const id = ++seq
      return new Promise<AskUserAnswers>((resolve, reject) => {
        let settled = false
        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          setAskQueue((list) => list.filter((x) => x.id !== id))
          fn()
        }
        setAskQueue((list) => [
          ...list,
          {
            id,
            req,
            resolve: (a) => finish(() => resolve(a)),
            reject: (e) => finish(() => reject(e)),
          },
        ])
        signal.addEventListener(
          'abort',
          () => finish(() => reject(new Error('aborted'))),
          { once: true },
        )
      })
    })
  }, [])

  return { askQueue }
}
