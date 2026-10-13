import { useMemo } from 'react'
import type { ConversationNode } from '@yagent/core'
import { childrenMap, formatMsgTime, nodeLabel } from '../lib/utils'

const LANE_X = 20 // 泳道 x 间距
const ROW_H = 44 // 行高
const X_OFF = 12
const Y_OFF = 22

interface BranchTreeProps {
  nodes: Record<string, ConversationNode>
  activeNodeId: string
  onSelect: (nodeId: string) => void
}

interface LayoutNode {
  id: string
  depth: number
  lane: number
  branchIndex: number | null // 分叉时的 child 序号（0 = 分支A），非分叉为 null
  onPath: boolean
  isLeaf: boolean
}

/**
 * 数据驱动的 git 风格分支树：
 * 输入节点树 → 行 = 深度，泳道自动分配（单 child 继承父泳道，分叉的每个 child 开新泳道）→ 生成 SVG path
 */
export function BranchTree({ nodes, activeNodeId, onSelect }: BranchTreeProps) {
  const layout = useMemo(() => {
    const kids = childrenMap(nodes)
    const root = Object.values(nodes).find((n) => n.parentId === null)
    if (!root) return null

    // 当前路径集合（根 → activeNodeId）
    const onPath = new Set<string>()
    let cur: ConversationNode | undefined = nodes[activeNodeId]
    while (cur) {
      onPath.add(cur.id)
      cur = cur.parentId ? nodes[cur.parentId] : undefined
    }

    const laneOf = new Map<string, number>()
    const depthOf = new Map<string, number>()
    const branchIndexOf = new Map<string, number | null>()
    let nextLane = 1

    // BFS：行 = 深度；单 child 继承父泳道，分叉 child 各自开新泳道
    const queue: string[] = [root.id]
    laneOf.set(root.id, 0)
    depthOf.set(root.id, 0)
    branchIndexOf.set(root.id, null)
    let maxDepth = 0
    while (queue.length) {
      const id = queue.shift()!
      const lane = laneOf.get(id)!
      const depth = depthOf.get(id)!
      maxDepth = Math.max(maxDepth, depth)
      const children = kids.get(id) ?? []
      children.forEach((childId, i) => {
        const childLane = children.length === 1 ? lane : nextLane++
        laneOf.set(childId, childLane)
        depthOf.set(childId, depth + 1)
        branchIndexOf.set(childId, children.length > 1 ? i : null)
        queue.push(childId)
      })
    }

    const list: LayoutNode[] = Object.values(nodes).map((n) => ({
      id: n.id,
      depth: depthOf.get(n.id) ?? 0,
      lane: laneOf.get(n.id) ?? 0,
      branchIndex: branchIndexOf.get(n.id) ?? null,
      onPath: onPath.has(n.id),
      isLeaf: !(kids.get(n.id)?.length),
    }))
    list.sort((a, b) => a.depth - b.depth || a.lane - b.lane)

    return { list, kids, maxLane: nextLane - 1, maxDepth, onPath }
  }, [nodes, activeNodeId])

  if (!layout) return null

  const { list, maxLane, maxDepth, onPath } = layout
  const byId = new Map(list.map((n) => [n.id, n]))
  const svgW = maxLane * LANE_X + X_OFF * 2
  const svgH = (maxDepth + 1) * ROW_H
  const BRANCH_NAMES = 'ABCDEFGH'

  const x = (lane: number) => lane * LANE_X + X_OFF
  const y = (depth: number) => depth * ROW_H + Y_OFF

  // 行 → 该深度所有节点（按泳道排序）
  const rows = new Map<number, LayoutNode[]>()
  for (const n of list) {
    const arr = rows.get(n.depth) ?? []
    arr.push(n)
    rows.set(n.depth, arr)
  }

  return (
    <div className="gtree">
      <svg
        className="gtree-svg"
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
      >
        {/* 连线：同泳道直线，跨泳道三次贝塞尔；当前路径紫色 */}
        {list
          .filter((n) => nodes[n.id].parentId)
          .map((n) => {
            const parent = byId.get(nodes[n.id].parentId!)!
            const current = onPath.has(n.id)
            const x1 = x(parent.lane)
            const y1 = y(parent.depth)
            const x2 = x(n.lane)
            const y2 = y(n.depth)
            const d =
              x1 === x2
                ? `M${x1} ${y1} V${y2}`
                : `M${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
            return (
              <path
                key={`e-${n.id}`}
                className={`g-edge${current ? ' g-edge-cur' : ''}`}
                d={d}
              />
            )
          })}
        {/* 当前节点光晕 */}
        {(() => {
          const active = byId.get(activeNodeId)
          if (!active) return null
          return <circle className="g-dot-halo" cx={x(active.lane)} cy={y(active.depth)} r="8" />
        })()}
        {/* 节点圆点：绿=用户，紫=Agent；非当前路径的叶子（暂停分支末端）降透明度 */}
        {list.map((n) => {
          const dim = !n.onPath && n.isLeaf
          return (
            <circle
              key={`n-${n.id}`}
              className={`g-dot ${nodes[n.id].role === 'user' ? 'g-dot-user' : 'g-dot-agent'}`}
              cx={x(n.lane)}
              cy={y(n.depth)}
              r="4.5"
              opacity={dim ? 0.45 : 1}
              onClick={() => onSelect(n.id)}
              style={{ cursor: 'pointer' }}
            />
          )
        })}
      </svg>
      <div className="g-rows" style={{ marginLeft: svgW + 16 }}>
        {Array.from({ length: maxDepth + 1 }, (_, depth) => (
          <div className="g-row" key={depth}>
            {(rows.get(depth) ?? []).map((n) => {
              const node = nodes[n.id]
              const current = n.id === activeNodeId
              return (
                <div
                  key={n.id}
                  className={`g-label${current ? ' current' : ''}`}
                  style={!n.onPath && n.isLeaf ? { color: 'var(--text-2)' } : undefined}
                  onClick={() => onSelect(n.id)}
                >
                  {n.branchIndex != null && (
                    <span className={`g-tag${n.onPath ? '' : ' dim'}`}>
                      分支{BRANCH_NAMES[n.branchIndex] ?? n.branchIndex + 1}
                    </span>
                  )}
                  {nodeLabel(node)}
                  <span className="g-time">
                    {node.role === 'user' ? '用户' : 'yagent'} · {formatMsgTime(node.createdAt)}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
