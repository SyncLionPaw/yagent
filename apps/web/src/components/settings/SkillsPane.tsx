import { useEffect, useState, type DragEvent } from 'react'
import {
  ChevronDown,
  Download,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  deleteSkill,
  importDroppedSkillFiles,
  importExternalSkill,
  listSkills,
  pickAndImportSkills,
  readSkill,
  scanExternalSkills,
  skillsAvailable,
  skillsRoot,
  writeSkill,
  type ExternalSkillSource,
  type SkillSummary,
} from '../../skills'
import { syncSkillsIntoHarness } from '../../harness'

export function SkillsPane({ active }: { active: boolean }) {
  const [items, setItems] = useState<SkillSummary[]>([])
  const [root, setRoot] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [external, setExternal] = useState<ExternalSkillSource[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [importingKey, setImportingKey] = useState<string | null>(null)
  const [scanHint, setScanHint] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({})
  const available = skillsAvailable()

  const toggleSource = (id: string) => {
    setOpenSources((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))
  }

  const isSourceOpen = (id: string) => openSources[id] ?? true

  const reload = async () => {
    if (!available) return
    setLoading(true)
    setError(null)
    try {
      const [list, r] = await Promise.all([listSkills(), skillsRoot()])
      setItems(list)
      setRoot(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const onScan = async () => {
    if (!available) return
    setScanning(true)
    setError(null)
    setScanHint(null)
    try {
      const sources = await scanExternalSkills()
      setExternal(sources)
      const found = sources.reduce((n, s) => n + s.skills.length, 0)
      const ready = sources.reduce((n, s) => n + s.skills.filter((x) => !x.installed).length, 0)
      setScanHint(
        found === 0
          ? '未在常见 Agent 目录发现技能'
          : `发现 ${found} 个技能，其中 ${ready} 个可迁移`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const onImportOne = async (sourcePath: string, id: string, overwrite: boolean) => {
    const key = `${sourcePath}::${overwrite ? 'ow' : 'new'}`
    setImportingKey(key)
    setError(null)
    try {
      await importExternalSkill({ sourcePath, id, overwrite })
      await reload()
      const sources = await scanExternalSkills()
      setExternal(sources)
      void syncSkillsIntoHarness()
      setScanHint(overwrite ? `已覆盖更新「${id}」` : `已导入「${id}」`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingKey(null)
    }
  }

  const onImportSource = async (src: ExternalSkillSource) => {
    const pending = src.skills.filter((s) => !s.installed)
    if (pending.length === 0) return
    setImportingKey(`src:${src.id}`)
    setError(null)
    let ok = 0
    let fail = 0
    try {
      for (const s of pending) {
        try {
          await importExternalSkill({ sourcePath: s.path, id: s.id })
          ok++
        } catch {
          fail++
        }
      }
      await reload()
      const sources = await scanExternalSkills()
      setExternal(sources)
      void syncSkillsIntoHarness()
      setScanHint(
        fail === 0
          ? `已从 ${src.label} 导入 ${ok} 个技能`
          : `从 ${src.label} 导入 ${ok} 个，失败 ${fail} 个`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingKey(null)
    }
  }

  const finishUpload = async (imported: SkillSummary[], errors: string[]) => {
    await reload()
    if (imported.length) void syncSkillsIntoHarness()
    if (errors.length) setError(errors.join('\n'))
    if (imported.length) {
      setScanHint(
        imported.length === 1
          ? `已上传「${imported[0]!.name || imported[0]!.id}」`
          : `已上传 ${imported.length} 个技能`,
      )
    } else if (!errors.length) {
      setScanHint('未导入任何技能')
    }
  }

  const onPickUpload = async () => {
    if (uploading) return
    setUploading(true)
    setError(null)
    try {
      const { imported, canceled, errors } = await pickAndImportSkills()
      if (canceled) return
      await finishUpload(imported, errors || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const onDropUpload = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (uploading) return
    const files = Array.from(e.dataTransfer.files || [])
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      const { imported, errors } = await importDroppedSkillFiles(files)
      await finishUpload(imported, errors)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    if (active) void reload()
  }, [active, available])

  const startEdit = async (id: string) => {
    setError(null)
    try {
      const detail = await readSkill(id)
      if (!detail) return
      setEditingId(id)
      setDraft(detail.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      await writeSkill(editingId, draft)
      setEditingId(null)
      setDraft('')
      await reload()
      void syncSkillsIntoHarness()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (id: string) => {
    if (!confirm(`删除技能「${id}」？此操作不可恢复。`)) return
    setError(null)
    try {
      await deleteSkill(id)
      if (editingId === id) {
        setEditingId(null)
        setDraft('')
      }
      await reload()
      void syncSkillsIntoHarness()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!available) {
    return (
      <>
        <div className="sub-label">本地技能</div>
        <p className="user-profile-hint">技能目录需要桌面端（默认 `.yagent/skills/`）。浏览器环境暂不可用。</p>
      </>
    )
  }

  return (
    <>
      <div className="sub-label">存储位置</div>
      <div className="skill-root">{root ?? '…'}</div>

      <div className="skill-scan-block">
        <div className="skill-scan-head">
          <div className="sub-label">扫描与同步</div>
          <button type="button" className="btn btn-sm" disabled={scanning} onClick={() => void onScan()}>
            <RefreshCw className={`ic ic-sm${scanning ? ' spin' : ''}`} />
            {scanning ? '扫描中…' : '扫描其他 Agent'}
          </button>
        </div>
        <p className="user-profile-hint">
          扫描 Cursor / Claude / Codex / Agents 等目录下的技能，迁移到本机 yagent skills。
        </p>
        {scanHint && <div className="skill-scan-hint">{scanHint}</div>}
        {external &&
          external.map((src) => {
            const open = isSourceOpen(src.id)
            return (
              <div className={`skill-source${open ? ' is-open' : ''}`} key={src.id}>
                <div className="skill-source-head">
                  <button
                    type="button"
                    className="skill-source-toggle"
                    aria-expanded={open}
                    onClick={() => toggleSource(src.id)}
                  >
                    <ChevronDown className={`ic ic-sm skill-source-chevron${open ? '' : ' is-collapsed'}`} />
                    <span className="skill-source-title">
                      {src.label}
                      <span className="skill-badge">{src.exists ? `${src.skills.length}` : '未找到'}</span>
                    </span>
                  </button>
                  {src.exists && src.skills.some((s) => !s.installed) ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={importingKey === `src:${src.id}`}
                      onClick={() => void onImportSource(src)}
                    >
                      全部迁移
                    </button>
                  ) : null}
                </div>
                {open && (
                  <>
                    <div className="skill-source-path">{src.root}</div>
                    {!src.exists && <div className="skill-empty">目录不存在</div>}
                    {src.exists && src.skills.length === 0 && (
                      <div className="skill-empty">该目录下没有 SKILL.md</div>
                    )}
                    {src.skills.map((s) => (
                      <div className="skill-card skill-card-ext" key={`${src.id}:${s.id}`}>
                        <div className="skill-card-main">
                          <div className="skill-card-title">
                            {s.name}
                            {s.installed ? (
                              <span className="skill-badge skill-badge-ok">已安装</span>
                            ) : null}
                          </div>
                          <div className="skill-card-desc">{s.description || s.id}</div>
                        </div>
                        <div className="skill-card-actions">
                          {s.installed ? (
                            <button
                              type="button"
                              className="icon-btn"
                              title="覆盖更新"
                              disabled={!!importingKey}
                              onClick={() => {
                                if (!confirm(`用 ${src.label} 的「${s.id}」覆盖本地副本？`)) return
                                void onImportOne(s.path, s.id, true)
                              }}
                            >
                              <RefreshCw className="ic ic-sm" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="icon-btn"
                              title="迁移到 yagent"
                              disabled={!!importingKey}
                              onClick={() => void onImportOne(s.path, s.id, false)}
                            >
                              <Download className="ic ic-sm" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )
          })}
      </div>

      <div className="sub-label">已安装</div>
      {loading && <div className="skill-empty">加载中…</div>}
      {!loading && items.length === 0 && (
        <div className="skill-empty">还没有技能。每个技能是一个含 SKILL.md 的文件夹。</div>
      )}
      {items.map((s) => (
        <div className="skill-card" key={s.id}>
          <div className="skill-card-main">
            <div className="skill-card-title">
              {s.name}
              {s.disableModelInvocation ? (
                <span className="skill-badge" title="仅显式调用；不进模型自动目录">
                  手动
                </span>
              ) : null}
            </div>
            <div className="skill-card-desc">{s.description || s.id}</div>
          </div>
          <div className="skill-card-actions">
            <button
              type="button"
              className="icon-btn"
              title="编辑"
              onClick={() => void startEdit(s.id)}
            >
              <Pencil className="ic ic-sm" />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="删除"
              onClick={() => void onDelete(s.id)}
            >
              <Trash2 className="ic ic-sm" />
            </button>
          </div>
        </div>
      ))}

      {editingId && (
        <>
          <div className="sub-label">编辑 {editingId}/SKILL.md</div>
          <textarea
            className="skill-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="byok-row">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveEdit()}>
              保存
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditingId(null)
                setDraft('')
              }}
            >
              取消
            </button>
          </div>
        </>
      )}

      <div className="sub-label">上传技能</div>
      <button
        type="button"
        className={`skill-upload-zone${dragOver ? ' is-dragover' : ''}${uploading ? ' is-busy' : ''}`}
        disabled={uploading}
        onClick={() => void onPickUpload()}
        onDragEnter={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragOver(false)
        }}
        onDrop={(e) => void onDropUpload(e)}
      >
        <Upload className={`ic${uploading ? ' spin' : ''}`} />
        <div className="skill-upload-title">
          {uploading ? '正在导入…' : '点击选择，或拖入 .zip / 技能文件夹'}
        </div>
        <div className="skill-upload-hint">需包含 SKILL.md；zip 可含一个或多个技能目录</div>
      </button>

      {error && <div className="field-warn">{error}</div>}
    </>
  )
}
