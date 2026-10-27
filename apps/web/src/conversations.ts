import { ConversationStore, type ConversationStorage } from '@yagent/core'
import { harness } from './harness'

const INDEX_KEY = 'yagent-convs'
const CONV_PREFIX = 'yagent-conv-'

// Electron 走 IPC 文件存储（<dataDir>/projects|chats/），纯浏览器走 localStorage
function createConversationStorage(): ConversationStorage {
  const ipc = window.yagentDesktop?.conversations
  if (ipc) return ipc

  const readIndex = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  }
  const lsGet = (key: string): string => {
    try {
      return localStorage.getItem(CONV_PREFIX + key) ?? ''
    } catch {
      return ''
    }
  }
  const lsSet = (key: string, content: string) => {
    try {
      localStorage.setItem(CONV_PREFIX + key, content)
      const keys = readIndex()
      if (!keys.includes(key)) {
        keys.push(key)
        localStorage.setItem(INDEX_KEY, JSON.stringify(keys))
      }
    } catch {
      // 超配额等写失败静默
    }
  }
  return {
    async list() {
      const out: { key: string; text: string }[] = []
      for (const key of readIndex()) {
        const text = lsGet(key)
        if (text) out.push({ key, text })
      }
      return out
    },
    // localStorage 没有真 append，读出拼接再写回
    async append(key, lines) {
      lsSet(key, lsGet(key) + lines)
    },
    async write(key, content) {
      lsSet(key, content)
    },
    async delete(key) {
      try {
        localStorage.removeItem(CONV_PREFIX + key)
        localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((x) => x !== key)))
      } catch {
        // 同上
      }
    },
  }
}

export const conversationStore = new ConversationStore(harness, createConversationStorage())
