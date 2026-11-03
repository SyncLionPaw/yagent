import { useCallback, useEffect, useState } from 'react'
import { BookMarked, Check, ChevronDown, ChevronUp, Cpu, FolderOpen, Lightbulb, MessageCircle, Moon, Palette, Plug, Plus, RefreshCw, Server, Settings as SettingsIcon, Sparkles, Sun, User, Wrench, X } from 'lucide-react'
import { isSshWorkdir, projectDisplayName } from '@yagent/core'
import type { Conversation } from '@yagent/core'
import { formatSidebarTime } from '../lib/utils'
import type { SettingsPaneId } from './SettingsPanel'

interface SidebarProps {
  conversations: Conversation[]
  /** 已登记项目（含删光会话的空项目） */
  knownProjects: string[]
  activeId: string
  theme: 'light' | 'dark'
  settingsOpen: boolean
  settingsPane: SettingsPaneId
  nickname: string
  avatarLetter: string
  onSelect: (id: string) => void
  onNewChat: () => void
  onNewTaskWithWorkdir: () => void
  /** 新建绑定 SSH 远程目录的任务（host 为 ssh config 别名或 user@host） */
  onNewSshTask: (host: string, path: string) => void
  onNewTaskInProject: (workdir: string) => void
  onForgetProject: (workdir: string) => void
  onToggleTheme: () => void
  onOpenSettings: () => void
  onOpenUserSettings: () => void
  onSelectSettingsPane: (p: SettingsPaneId) => void
}

const SETTINGS_MENU: { id: SettingsPaneId; label: string; icon: typeof Cpu }[] = [
  { id: 'user', label: '用户', icon: User },
  { id: 'models', label: '模型配置', icon: Cpu },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'skills', label: '技能', icon: Sparkles },
  { id: 'inspiration', label: '灵感', icon: Lightbulb },
  { id: 'knowledge', label: '知识库', icon: BookMarked },
  { id: 'tools', label: '工具', icon: Wrench },
  { id: 'connectors', label: '连接器', icon: Plug },
]

const DOT_CLASS: Record<Conversation['status'], string> = {
  running: 'dot dot-run',
  waiting: 'dot dot-wait',
  done: 'dot dot-done',
}

// 空会话（新建任务）没有节点，记录首次见到的时间作为分组/显示基准
const emptyConvTs = new Map<string, number>()
function emptyConvFallback(id: string): number {
  let ts = emptyConvTs.get(id)
  if (!ts) {
    ts = Date.now()
    emptyConvTs.set(id, ts)
  }
  return ts
}

export function Sidebar({
  conversations,
  knownProjects,
  activeId,
  theme,
  settingsOpen,
  settingsPane,
  nickname,
  avatarLetter,
  onSelect,
  onNewChat,
  onNewTaskWithWorkdir,
  onNewSshTask,
  onNewTaskInProject,
  onForgetProject,
  onToggleTheme,
  onOpenSettings,
  onOpenUserSettings,
  onSelectSettingsPane,
}: SidebarProps) {
  const [taskMenuOpen, setTaskMenuOpen] = useState(false)
  // SSH 远程任务：选主机 + 输远程路径
  const [sshOpen, setSshOpen] = useState(false)
  const [sshHosts, setSshHosts] = useState<{ host: string; hostname?: string; user?: string; port?: string }[]>([])
  const [sshHost, setSshHost] = useState('')
  const [sshHostOpen, setSshHostOpen] = useState(false)
  // 远程目录浏览
  const [sshPath, setSshPath] = useState('~')
  const [sshDirs, setSshDirs] = useState<string[]>([])
  const [sshDirsState, setSshDirsState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [sshDirsErr, setSshDirsErr] = useState('')
  // 任务区项目分组的折叠状态
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [archivedOpen, setArchivedOpen] = useState(false)
  // 目录选择依赖桌面端桥接，浏览器环境只能提示
  const canPickDir = !!window.yagentDesktop?.dialog?.selectDirectory

  // 点击他处收起新建菜单
  useEffect(() => {
    if (!taskMenuOpen) return
    const close = () => setTaskMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [taskMenuOpen])

  // 打开 SSH 表单时加载 ~/.ssh/config 主机
  useEffect(() => {
    if (!sshOpen) return
    window.yagentDesktop?.ssh?.listHosts().then((hosts) => {
      setSshHosts(hosts)
      if (hosts.length && !sshHost) setSshHost(hosts[0]!.host)
    })
  }, [sshOpen])

  // 连接主机并列出指定远程目录的子目录
  const loadSshDirs = useCallback(async (host: string, dir: string) => {
    if (!host.trim()) return
    setSshDirsState('loading')
    setSshDirsErr('')
    try {
      const res = await window.yagentDesktop?.ssh?.listDirs(host, dir)
      if (!res) throw new Error('桌面端桥接不可用')
      if (!res.ok) {
        setSshDirsState('error')
        setSshDirsErr(res.error || '无法列出目录')
        setSshDirs([])
        return
      }
      setSshDirs(res.dirs)
      setSshDirsState('idle')
    } catch (e: any) {
      setSshDirsState('error')
      setSshDirsErr(String(e?.message ?? e))
      setSshDirs([])
    }
  }, [])

  // 主机选定后自动读取其家目录
  useEffect(() => {
    if (!sshOpen || !sshHost.trim()) return
    setSshPath('~')
    loadSshDirs(sshHost, '~')
  }, [sshOpen, sshHost, loadSshDirs])

  // 进入子目录 / 返回上级
  const sshEnter = (sub: string) => {
    const next = sshPath === '~' ? `~/${sub}` : `${sshPath.replace(/\/$/, '')}/${sub}`
    setSshPath(next)
    loadSshDirs(sshHost, next)
  }
  const sshUp = () => {
    if (sshPath === '~' || sshPath === '/') return
    const next = sshPath.startsWith('~/')
      ? sshPath.slice(0, sshPath.lastIndexOf('/')) || '~'
      : sshPath.slice(0, sshPath.lastIndexOf('/')) || '/'
    setSshPath(next)
    loadSshDirs(sshHost, next)
  }

  const convTs = (conv: Conversation) => {
    const ts = Object.values(conv.nodes).map((n) => n.createdAt)
    return ts.length ? Math.max(...ts) : emptyConvFallback(conv.id)
  }
  // 活跃会话：任务（按项目分组）在上，纯对话在下；归档单独收在底部
  const active = conversations.filter((c) => !c.archived)
  const archived = conversations.filter((c) => c.archived).sort((a, b) => convTs(b) - convTs(a))
  const tasks = active.filter((c) => c.workdir).sort((a, b) => convTs(b) - convTs(a))
  const chats = active.filter((c) => !c.workdir).sort((a, b) => convTs(b) - convTs(a))
  const projects: { workdir: string; items: Conversation[]; latest: number }[] = []
  for (const conv of tasks) {
    let p = projects.find((x) => x.workdir === conv.workdir)
    if (!p) {
      p = { workdir: conv.workdir!, items: [], latest: 0 }
      projects.push(p)
    }
    p.items.push(conv)
    p.latest = Math.max(p.latest, convTs(conv))
  }
  // 已登记但暂无会话的空项目仍显示，方便马上再建任务
  for (const wd of knownProjects) {
    if (!projects.some((p) => p.workdir === wd)) {
      projects.push({ workdir: wd, items: [], latest: 0 })
    }
  }
  projects.sort((a, b) => b.latest - a.latest)

  const convTime = (conv: Conversation) => formatSidebarTime(convTs(conv))

  return (
    <aside className={`sidebar${settingsOpen ? ' settings-mode' : ''}`}>
      <div className="sidebar-header"></div>

      {settingsOpen ? (
        /* 设置态：会话列表区整个换成设置菜单 */
        <div className="sidebar-scroll">
          <div className="nav-label">设置</div>
          {SETTINGS_MENU.map((m) => {
            const Icon = m.icon
            return (
              <div
                key={m.id}
                className={`conv s-menu${settingsPane === m.id ? ' active' : ''}`}
                onClick={() => onSelectSettingsPane(m.id)}
              >
                <Icon className="ic" />
                <span className="title">{m.label}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="nt-wrap">
            <button
              className="new-task"
              onClick={(e) => {
                e.stopPropagation()
                setTaskMenuOpen((v) => !v)
              }}
            >
              <Plus className="ic" />
              <span>新建任务</span>
              <span className="kbd">⌘N</span>
            </button>
            <div
              className={`nt-menu${taskMenuOpen ? ' open' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="mode-opt"
                onClick={() => {
                  setTaskMenuOpen(false)
                  onNewChat()
                }}
              >
                <span className="m-icon">
                  <MessageCircle className="ic" />
                </span>
                <span>
                  <span className="m-title">纯对话</span>
                  <span className="m-desc">只聊天问答，不绑定目录</span>
                </span>
              </button>
              <button
                className="mode-opt"
                disabled={!canPickDir}
                onClick={() => {
                  setTaskMenuOpen(false)
                  onNewTaskWithWorkdir()
                }}
              >
                <span className="m-icon">
                  <FolderOpen className="ic" />
                </span>
                <span>
                  <span className="m-title">本地目录</span>
                  <span className="m-desc">选择一个本地文件夹，任务在其中执行</span>
                </span>
              </button>
              <button
                className="mode-opt"
                onClick={() => {
                  setTaskMenuOpen(false)
                  setSshOpen(true)
                }}
              >
                <span className="m-icon">
                  <Server className="ic" />
                </span>
                <span>
                  <span className="m-title">SSH 远程</span>
                  <span className="m-desc">连接远程主机目录（执行支持即将上线）</span>
                </span>
              </button>
              {!canPickDir && (
                <div className="nt-hint">浏览器环境无法选择本地目录，请使用桌面端</div>
              )}
            </div>
          </div>

          {sshOpen && (
            <div className="ssh-overlay" onClick={() => setSshOpen(false)}>
              <div className="ssh-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="ssh-title">
                  <Server className="ic" />
                  新建 SSH 远程任务
                </div>
                <div className="ssh-field">
                  <span className="ssh-label">主机</span>
                  {sshHosts.length > 0 ? (
                    <div className="ssh-select">
                      <button
                        type="button"
                        className={`ssh-select-btn${sshHostOpen ? ' open' : ''}`}
                        onClick={() => setSshHostOpen((v) => !v)}
                      >
                        <Server className="ic ic-sm" />
                        <span className="ssh-select-val">{sshHost || '选择主机'}</span>
                        <ChevronDown className="ic ic-sm ssh-caret" />
                      </button>
                      {sshHostOpen && (
                        <div className="ssh-select-pop">
                          {sshHosts.map((h) => (
                            <button
                              key={h.host}
                              type="button"
                              className={`mode-opt${h.host === sshHost ? ' active' : ''}`}
                              onClick={() => {
                                setSshHost(h.host)
                                setSshHostOpen(false)
                              }}
                            >
                              <span className="m-icon">
                                <Server className="ic" />
                              </span>
                              <span className="m-body">
                                <span className="m-title">{h.host}</span>
                                {h.user && (
                                  <span className="m-desc">
                                    {h.user}
                                    {h.hostname ? `@${h.hostname}` : ''}
                                    {h.port ? ` :${h.port}` : ''}
                                  </span>
                                )}
                              </span>
                              <span className="m-check">
                                <Check className="ic ic-sm" />
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      className="ssh-input"
                      value={sshHost}
                      onChange={(e) => setSshHost(e.target.value)}
                      placeholder="user@host（~/.ssh/config 暂无主机）"
                    />
                  )}
                </div>
                <div className="ssh-field">
                  <span className="ssh-label">远程目录</span>
                  <div className="ssh-dirbar">
                    <button
                      type="button"
                      className="icon-btn"
                      title="上一级"
                      disabled={sshPath === '~' || sshPath === '/'}
                      onClick={sshUp}
                    >
                      <ChevronUp className="ic ic-sm" />
                    </button>
                    <span className="ssh-cur" title={sshPath}>
                      {sshPath}
                    </span>
                    <button
                      type="button"
                      className={`icon-btn ssh-refresh${sshDirsState === 'loading' ? ' spin' : ''}`}
                      title="重新读取"
                      onClick={() => loadSshDirs(sshHost, sshPath)}
                    >
                      <RefreshCw className="ic ic-sm" />
                    </button>
                  </div>
                  <div className="ssh-dirlist">
                    {sshDirsState === 'loading' ? (
                      <div className="ssh-dir-empty">连接中…</div>
                    ) : sshDirsState === 'error' ? (
                      <div className="ssh-dir-empty ssh-dir-err" title={sshDirsErr}>
                        无法读取：{sshDirsErr}
                      </div>
                    ) : sshDirs.length === 0 ? (
                      <div className="ssh-dir-empty">（无子目录，可直接用当前目录创建）</div>
                    ) : (
                      sshDirs.map((d) => (
                        <button key={d} type="button" className="ssh-dir-item" onClick={() => sshEnter(d)}>
                          <FolderOpen className="ic ic-sm" />
                          <span>{d}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <div className="ssh-actions">
                  <button className="ssh-cancel" onClick={() => setSshOpen(false)}>
                    取消
                  </button>
                  <button
                    className="ssh-ok"
                    disabled={!sshHost.trim() || !sshPath.trim() || sshDirsState === 'loading'}
                    onClick={() => {
                      onNewSshTask(sshHost.trim(), sshPath.trim())
                      setSshOpen(false)
                    }}
                  >
                    创建
                  </button>
                </div>
                <div className="ssh-note">读写与命令将通过 ssh 在远程主机执行。</div>
              </div>
            </div>
          )}

          <div className="sidebar-scroll">
            {projects.length > 0 && (
              <div>
                <div className="nav-label">任务</div>
                {projects.map((p) => {
                  const collapsed = collapsedProjects.has(p.workdir)
                  return (
                    <div key={p.workdir}>
                      <div
                        className="proj-head"
                        title={p.workdir}
                        onClick={() =>
                          setCollapsedProjects((s) => {
                            const next = new Set(s)
                            if (next.has(p.workdir)) next.delete(p.workdir)
                            else next.add(p.workdir)
                            return next
                          })
                        }
                      >
                        <ChevronDown className={`ic ic-sm proj-caret${collapsed ? ' closed' : ''}`} />
                        {isSshWorkdir(p.workdir) ? (
                          <Server className="ic ic-sm proj-ssh" />
                        ) : (
                          <FolderOpen className="ic ic-sm" />
                        )}
                        <span className="proj-name">{projectDisplayName(p.workdir)}</span>
                        <span className="proj-count">{p.items.length}</span>
                        <button
                          className="icon-btn proj-new"
                          title="在此项目下新建任务"
                          onClick={(e) => {
                            e.stopPropagation()
                            setCollapsedProjects((s) => {
                              const next = new Set(s)
                              next.delete(p.workdir)
                              return next
                            })
                            onNewTaskInProject(p.workdir)
                          }}
                        >
                          <Plus className="ic ic-sm" />
                        </button>
                        {p.items.length === 0 && (
                          <button
                            className="icon-btn proj-forget"
                            title="从列表移除空项目"
                            onClick={(e) => {
                              e.stopPropagation()
                              onForgetProject(p.workdir)
                            }}
                          >
                            <X className="ic ic-sm" />
                          </button>
                        )}
                      </div>
                      {!collapsed &&
                        (p.items.length === 0 ? (
                          <div className="proj-empty">暂无任务，点 + 新建</div>
                        ) : (
                          p.items.map((conv) => (
                            <div
                              key={conv.id}
                              className={`conv conv-sub${conv.id === activeId ? ' active' : ''}`}
                              onClick={() => onSelect(conv.id)}
                            >
                              <span className={DOT_CLASS[conv.status]}></span>
                              <span className="title">{conv.title}</span>
                              <span className="time">{convTime(conv)}</span>
                            </div>
                          ))
                        ))}
                    </div>
                  )
                })}
              </div>
            )}
            {chats.length > 0 && (
              <div>
                <div className="nav-label">对话</div>
                {chats.map((conv) => (
                  <div
                    key={conv.id}
                    className={`conv${conv.id === activeId ? ' active' : ''}`}
                    onClick={() => onSelect(conv.id)}
                  >
                    <span className={DOT_CLASS[conv.status]}></span>
                    <span className="title">{conv.title}</span>
                    <span className="time">{convTime(conv)}</span>
                  </div>
                ))}
              </div>
            )}
            {archived.length > 0 && (
              <div>
                <div
                  className="nav-label nav-label-toggle"
                  onClick={() => setArchivedOpen((v) => !v)}
                >
                  已归档
                  <span className="proj-count">{archived.length}</span>
                  <ChevronDown className={`ic ic-sm proj-caret${archivedOpen ? '' : ' closed'}`} />
                </div>
                {archivedOpen &&
                  archived.map((conv) => (
                    <div
                      key={conv.id}
                      className={`conv conv-archived${conv.id === activeId ? ' active' : ''}`}
                      onClick={() => onSelect(conv.id)}
                    >
                      <span className={DOT_CLASS[conv.status]}></span>
                      <span className="title">{conv.title}</span>
                      <span className="time">{convTime(conv)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="sidebar-footer" onClick={onOpenUserSettings}>
        <div className="avatar">{avatarLetter}</div>
        <div className="ws">{nickname}</div>
        <div className="footer-actions">
          <button
            className="icon-btn"
            title="切换主题"
            onClick={(e) => {
              e.stopPropagation()
              onToggleTheme()
            }}
          >
            {theme === 'dark' ? <Sun className="ic" /> : <Moon className="ic" />}
          </button>
          <button
            className={`icon-btn${settingsOpen ? ' active' : ''}`}
            title="设置"
            onClick={(e) => {
              e.stopPropagation()
              onOpenSettings()
            }}
          >
            <SettingsIcon className="ic" />
          </button>
        </div>
      </div>
    </aside>
  )
}
