import { useState } from 'react'
import { Cpu, KeyRound, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { Settings } from '@yagent/core'
import { devDeepseekKey, keyHasBadChars, maskKey, testConnection, type TestTarget } from '../harness'
import { formatDaysAgo } from '../lib/utils'

interface SettingsModalProps {
  open: boolean
  settings: Settings
  onChange: (settings: Settings) => void
  onClose: () => void
}

type PaneId = 'byok' | 'models' | 'memory'

const PANE_META: Record<PaneId, [string, string]> = {
  byok: ['API 密钥', '使用你自己的 API Key（BYOK），密钥仅存储在本地'],
  models: ['模型配置', '自定义可用模型：名称、提供商、模型 ID'],
  memory: ['记忆与工具', '查看 Agent 记住的内容，配置默认工具与沙箱'],
}

export function SettingsModal({ open, settings, onChange, onClose }: SettingsModalProps) {
  const [pane, setPane] = useState<PaneId>('byok')
  const [title, desc] = PANE_META[pane]

  return (
    <div
      className={`overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings">
        <nav className="settings-nav">
          <div className="nav-head">设置</div>
          <button
            className={`s-tab${pane === 'byok' ? ' active' : ''}`}
            onClick={() => setPane('byok')}
          >
            <KeyRound className="ic" />
            API 密钥
          </button>
          <button
            className={`s-tab${pane === 'models' ? ' active' : ''}`}
            onClick={() => setPane('models')}
          >
            <Cpu className="ic" />
            模型配置
          </button>
          <button
            className={`s-tab${pane === 'memory' ? ' active' : ''}`}
            onClick={() => setPane('memory')}
          >
            <Sparkles className="ic" />
            记忆与工具
          </button>
        </nav>

        <div className="settings-body">
          <div className="settings-head">
            <div>
              <h2>{title}</h2>
              <div className="desc">{desc}</div>
            </div>
            <button className="settings-close" onClick={onClose}>
              <X className="ic" />
            </button>
          </div>

          <div className="settings-content">
            <div className={`s-pane${pane === 'byok' ? ' active' : ''}`}>
              <ByokPane settings={settings} onChange={onChange} />
            </div>
            <div className={`s-pane${pane === 'models' ? ' active' : ''}`}>
              <ModelsPane settings={settings} onChange={onChange} />
            </div>
            <div className={`s-pane${pane === 'memory' ? ' active' : ''}`}>
              <MemoryPane settings={settings} onChange={onChange} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- 1. API 密钥（BYOK） ---------- */

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

function ByokPane({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [savedFlash, setSavedFlash] = useState(false)
  const [tests, setTests] = useState<Partial<Record<TestTarget, { state: TestState; msg: string }>>>({})
  const setKey = (patch: Partial<Settings['apiKeys']>) =>
    onChange({ ...settings, apiKeys: { ...settings.apiKeys, ...patch } })

  // 测试连接：真发一次 GET /models 验证连通（deepseek 未填 key 时用 dev 预填）
  const runTest = async (target: TestTarget) => {
    setTests((m) => ({ ...m, [target]: { state: 'testing', msg: '' } }))
    try {
      const ms = await testConnection(target, settings.apiKeys)
      setTests((m) => ({ ...m, [target]: { state: 'ok', msg: ms } }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTests((m) => ({ ...m, [target]: { state: 'fail', msg: msg.slice(0, 60) } }))
    }
  }

  const testTag = (target: TestTarget) => {
    const t = tests[target]
    if (!t || t.state === 'idle') return null
    if (t.state === 'testing') return <span className="tag-muted">测试中…</span>
    if (t.state === 'ok') return <span className="tag-ok">已连通 · {t.msg}</span>
    return <span className="tag-fail">失败 · {t.msg}</span>
  }

  const devKey = devDeepseekKey()
  const devOverride = !!devKey // .env 开发预填优先级最高，覆盖设置页的值

  // key 粘贴带入非法字符（空格/换行/全角）时的就地警示
  const badCharWarn = (v?: string) =>
    keyHasBadChars(v) ? (
      <div style={{ color: 'var(--red)', fontSize: 11.5, marginTop: 6 }}>
        检测到非法字符（粘贴时带入了空格、换行或全角字符），请清空后重新粘贴
      </div>
    ) : null

  return (
    <>
      <div className="field">
        <div className="field-label">
          Anthropic <span className="hint">claude.ai / console.anthropic.com</span>
        </div>
        <input
          type="password"
          placeholder="sk-ant-..."
          value={settings.apiKeys.anthropic ?? ''}
          onChange={(e) => setKey({ anthropic: e.target.value })}
        />
        {badCharWarn(settings.apiKeys.anthropic)}
        <div className="byok-row">
          <button className="btn" onClick={() => runTest('anthropic')}>
            测试连接
          </button>
          {settings.apiKeys.anthropic?.trim() && (
            <span className="tag-muted">已配置 {maskKey(settings.apiKeys.anthropic)}</span>
          )}
          {testTag('anthropic')}
        </div>
      </div>
      <div className="field">
        <div className="field-label">OpenAI</div>
        <input
          type="password"
          placeholder="sk-..."
          value={settings.apiKeys.openai ?? ''}
          onChange={(e) => setKey({ openai: e.target.value })}
        />
        {badCharWarn(settings.apiKeys.openai)}
        <div className="byok-row">
          <button className="btn" onClick={() => runTest('openai')}>
            测试连接
          </button>
          {settings.apiKeys.openai?.trim() && (
            <span className="tag-muted">已配置 {maskKey(settings.apiKeys.openai)}</span>
          )}
          {testTag('openai')}
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          DeepSeek <span className="hint">platform.deepseek.com</span>
        </div>
        <input
          type="password"
          placeholder={devOverride ? '开发预填优先生效，此处可留空' : 'sk-...'}
          value={settings.apiKeys.deepseek ?? ''}
          onChange={(e) => setKey({ deepseek: e.target.value })}
        />
        {badCharWarn(settings.apiKeys.deepseek)}
        <div className="byok-row">
          <button className="btn" onClick={() => runTest('deepseek')}>
            测试连接
          </button>
          {devOverride ? (
            <span className="tag-ok">开发预填 {maskKey(devKey)} 优先生效中</span>
          ) : (
            settings.apiKeys.deepseek?.trim() && (
              <span className="tag-muted">已配置 {maskKey(settings.apiKeys.deepseek)}</span>
            )
          )}
          {testTag('deepseek')}
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          自定义端点 <span className="hint">OpenAI 兼容协议</span>
        </div>
        <input
          type="text"
          placeholder="https://api.example.com/v1"
          style={{ marginBottom: 8 }}
          value={settings.apiKeys.customEndpoint ?? ''}
          onChange={(e) => setKey({ customEndpoint: e.target.value })}
        />
        {badCharWarn(settings.apiKeys.customEndpoint)}
        <input
          type="password"
          placeholder="API Key"
          value={settings.apiKeys.customKey ?? ''}
          onChange={(e) => setKey({ customKey: e.target.value })}
        />
        {badCharWarn(settings.apiKeys.customKey)}
        <div className="byok-row">
          <button className="btn" onClick={() => runTest('custom')}>
            测试连接
          </button>
          {settings.apiKeys.customKey?.trim() && (
            <span className="tag-muted">已配置 {maskKey(settings.apiKeys.customKey)}</span>
          )}
          {testTag('custom')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn btn-primary"
          onClick={() => {
            // onChange 时已自动持久化到 localStorage；按钮给出明确反馈
            setSavedFlash(true)
            setTimeout(() => setSavedFlash(false), 1600)
          }}
        >
          保存
        </button>
        {savedFlash && <span className="tag-ok">已保存到本地</span>}
      </div>
    </>
  )
}

/* ---------- 2. 模型配置 ---------- */

function ModelsPane({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('Anthropic')
  const [modelId, setModelId] = useState('')

  const removeModel = (id: string) =>
    onChange({ ...settings, models: settings.models.filter((m) => m.id !== id) })

  const addModel = () => {
    if (!name.trim() || !modelId.trim()) return
    onChange({
      ...settings,
      models: [
        ...settings.models,
        {
          id: `m-${Date.now()}`,
          name: name.trim(),
          provider:
            provider === 'Anthropic'
              ? 'anthropic'
              : provider === 'OpenAI'
                ? 'openai'
                : provider === 'DeepSeek'
                  ? 'deepseek'
                  : 'custom',
          modelId: modelId.trim(),
          context: 128_000,
        },
      ],
    })
    setName('')
    setModelId('')
  }

  return (
    <>
      <div className="sub-label">已配置的模型</div>
      {settings.models.map((m) => (
        <div className="row-card" key={m.id}>
          <div className="rc-main">
            <div className="rc-title">
              {m.name} {m.isDefault && <span className="tag-default">默认</span>}
            </div>
            <div className="rc-sub">
              {m.provider} · {m.modelId} · {Math.round(m.context / 1000)}k 上下文
            </div>
          </div>
          <div className="rc-actions">
            <button className="icon-btn" title="删除" onClick={() => removeModel(m.id)}>
              <Trash2 className="ic ic-sm" />
            </button>
          </div>
        </div>
      ))}

      <div className="sub-label">添加模型</div>
      <div className="field">
        <div className="field-label">显示名称</div>
        <input
          type="text"
          placeholder="例如：DeepSeek V4"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <div className="field-label">提供商 / 端点</div>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option>Anthropic</option>
            <option>OpenAI</option>
            <option>DeepSeek</option>
            <option>自定义端点</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <div className="field-label">模型 ID</div>
          <input
            type="text"
            placeholder="claude-sonnet-4-6"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
        </div>
      </div>
      <button className="btn" onClick={addModel}>
        <Plus className="ic ic-sm" />
        添加
      </button>
    </>
  )
}

/* ---------- 3. 记忆与工具 ---------- */

function MemoryPane({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const removeMemory = (id: string) =>
    onChange({ ...settings, memories: settings.memories.filter((m) => m.id !== id) })
  const toggleTool = (key: keyof Settings['tools']) =>
    onChange({ ...settings, tools: { ...settings.tools, [key]: !settings.tools[key] } })

  return (
    <>
      <div className="sub-label">
        记忆 <span style={{ fontWeight: 400 }}>· Agent 从对话中记住的偏好</span>
      </div>
      {settings.memories.map((m) => (
        <div className="row-card" key={m.id}>
          <div className="rc-main">
            <div className="rc-title" style={{ fontWeight: 400 }}>
              {m.text}
            </div>
            <div className="rc-sub">
              来自 {m.sourceCount} 个会话 · 更新于 {formatDaysAgo(m.updatedAt)}
            </div>
          </div>
          <div className="rc-actions">
            <button className="icon-btn" title="删除" onClick={() => removeMemory(m.id)}>
              <Trash2 className="ic ic-sm" />
            </button>
          </div>
        </div>
      ))}

      <div className="sub-label">默认工具</div>
      <div className="switch-row">
        <span className="sr-text">
          终端命令<small>允许 Agent 执行 shell 命令</small>
        </span>
        <button
          className={`switch${settings.tools.terminal ? ' on' : ''}`}
          onClick={() => toggleTool('terminal')}
        ></button>
      </div>
      <div className="switch-row">
        <span className="sr-text">
          文件编辑<small>允许直接修改工作区文件</small>
        </span>
        <button
          className={`switch${settings.tools.fileEdit ? ' on' : ''}`}
          onClick={() => toggleTool('fileEdit')}
        ></button>
      </div>
      <div className="switch-row">
        <span className="sr-text">
          网络搜索<small>允许访问互联网获取资料</small>
        </span>
        <button
          className={`switch${settings.tools.webSearch ? ' on' : ''}`}
          onClick={() => toggleTool('webSearch')}
        ></button>
      </div>

      <div className="sub-label">沙箱</div>
      <div className="field">
        <div className="field-label">执行环境</div>
        <div className="segmented">
          <button
            className={settings.sandbox.env === 'local' ? 'on' : ''}
            onClick={() =>
              onChange({ ...settings, sandbox: { ...settings.sandbox, env: 'local' } })
            }
          >
            本地直连
          </button>
          <button
            className={settings.sandbox.env === 'sandbox' ? 'on' : ''}
            onClick={() =>
              onChange({ ...settings, sandbox: { ...settings.sandbox, env: 'sandbox' } })
            }
          >
            隔离沙箱
          </button>
        </div>
      </div>
      <div className="field">
        <div className="field-label">工作目录</div>
        <input
          type="text"
          value={settings.sandbox.workdir}
          onChange={(e) =>
            onChange({ ...settings, sandbox: { ...settings.sandbox, workdir: e.target.value } })
          }
        />
      </div>
      <div className="switch-row">
        <span className="sr-text">沙箱内允许网络访问</span>
        <button
          className={`switch${settings.sandbox.network ? ' on' : ''}`}
          onClick={() =>
            onChange({
              ...settings,
              sandbox: { ...settings.sandbox, network: !settings.sandbox.network },
            })
          }
        ></button>
      </div>
    </>
  )
}
