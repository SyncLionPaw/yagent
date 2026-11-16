import { useCallback, useEffect, useState } from 'react'
import { harness } from '../harness'
import { conversationStore } from '../conversations'
import { forgetProject, listProjects, rememberProject } from '../projects'

/** 已知项目列表 + 启动时从会话 workdir 补登记 */
export function useProjects() {
  const [knownProjects, setKnownProjects] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      await conversationStore.loadAll().catch(() => undefined)
      for (const c of harness.listConversations()) {
        if (c.workdir?.trim()) await rememberProject(c.workdir)
      }
      setKnownProjects(await listProjects())
    })()
  }, [])

  const trackProject = useCallback((workdir: string | null | undefined) => {
    const wd = workdir?.trim()
    if (!wd) return
    setKnownProjects((list) => (list.includes(wd) ? list : [wd, ...list]))
    void rememberProject(wd)
  }, [])

  const handleForgetProject = useCallback((workdir: string) => {
    setKnownProjects((list) => list.filter((w) => w !== workdir))
    void forgetProject(workdir)
  }, [])

  return { knownProjects, trackProject, handleForgetProject }
}
