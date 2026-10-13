import { useEffect, useRef } from 'react'
import type { Conversation, ConversationNode } from '@yagent/core'
import { formatMsgTime, hasChildren, pathToActive, trunkIds } from '../lib/utils'
import { TextBlock } from './TextBlock'
import { ThoughtBlock } from './ThoughtBlock'
import { ToolCard } from './ToolCard'
import { ArtifactBlock } from './ArtifactBlock'

interface ChatViewProps {
  conversation: Conversation
  onRefClick: (id: number) => void
  onToggleFiles: () => void
}

/** 对话区：渲染当前会话从根到 activeNodeId 的路径 */
export function ChatView({ conversation, onRefClick, onToggleFiles }: ChatViewProps) {
  const chatRef = useRef<HTMLDivElement>(null)
  const path = pathToActive(conversation.nodes, conversation.activeNodeId)
  const last = path[path.length - 1]

  // 分支暂停：active 节点是不在主干上的叶子（非当前路径的分支末端）
  const isPausedBranch =
    last != null &&
    conversation.status !== 'done' &&
    !trunkIds(conversation.nodes).has(last.id) &&
    !hasChildren(conversation.nodes, last.id)

  // 新消息 / 流式更新时滚到底部
  const lastBlockCount = last?.blocks.length ?? 0
  const lastBlockKey = JSON.stringify(
    last?.blocks.map((b) => b.type + ('status' in b ? b.status : '')) ?? [],
  )
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation.id, conversation.activeNodeId, lastBlockCount, lastBlockKey])

  return (
    <div className="chat" ref={chatRef}>
      {path.map((node) => (
        <Message key={node.id} node={node} onRefClick={onRefClick} onToggleFiles={onToggleFiles} />
      ))}
      {conversation.status === 'waiting' && (
        <div className="msg msg-agent">
          <div className="wait-bar">
            <span className="dot dot-wait"></span>等待你的确认后继续在沙箱中验证
          </div>
        </div>
      )}
      {isPausedBranch && (
        <div className="msg msg-agent">
          <div className="wait-bar">
            <span className="dot dot-wait"></span>此分支已暂停 · 点击节点回到当前分支
          </div>
        </div>
      )}
    </div>
  )
}

function Message({
  node,
  onRefClick,
  onToggleFiles,
}: {
  node: ConversationNode
  onRefClick: (id: number) => void
  onToggleFiles: () => void
}) {
  const time = formatMsgTime(node.createdAt)

  if (node.role === 'user') {
    const text = node.blocks.find((b) => b.type === 'text')
    return (
      <div className="msg msg-user">
        <div className="msg-head">
          <span>{time}</span>
          <span className="who-user">你</span>
        </div>
        <div className="inner">
          <div className="bubble">{text?.type === 'text' ? text.text : ''}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="msg msg-agent">
      <div className="msg-head">
        <span className="who-agent">yagent</span>
        <span>{time}</span>
      </div>
      {node.blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return <TextBlock key={i} text={block.text} onRefClick={onRefClick} />
          case 'thinking':
            return (
              <ThoughtBlock
                key={i}
                text={block.text}
                status={block.status}
                durationMs={block.durationMs}
              />
            )
          case 'tool':
            return (
              <ToolCard
                key={i}
                tool={block.tool}
                summary={block.summary}
                status={block.status}
                detail={block.detail}
                stats={block.stats}
              />
            )
          case 'artifacts':
            return (
              <ArtifactBlock
                key={i}
                items={block.items}
                durationMs={node.durationMs}
                onToggleFiles={onToggleFiles}
              />
            )
        }
      })}
    </div>
  )
}
