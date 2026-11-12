import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { harness } from './harness'
import { conversationStore } from './conversations'

/** 启动时保证有一条未绑定目录的空「新对话」，供首屏选中 */
function ensureEmptyChat() {
  const empty = harness
    .listConversations()
    .find((c) => !c.archived && c.workdir == null && Object.keys(c.nodes).length === 0)
  if (empty) return empty
  return harness.createConversation('新对话', null)
}

async function bootstrap() {
  // 先恢复持久化会话，再渲染，保证首屏侧栏就是完整的
  await conversationStore.loadAll().catch(() => 0)
  // 每次启动落在空对话上，而不是上次任务
  ensureEmptyChat()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
