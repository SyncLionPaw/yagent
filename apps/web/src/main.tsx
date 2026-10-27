import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { harness } from './harness'
import { conversationStore } from './conversations'

async function bootstrap() {
  // 先恢复持久化会话，再渲染，保证首屏侧栏就是完整的
  await conversationStore.loadAll().catch(() => 0)
  // 无会话时开一条空对话（不落盘，发送后才持久化）；不再播种演示数据
  if (harness.listConversations().length === 0) {
    harness.createConversation('新对话', null)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
