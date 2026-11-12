declare global {
  interface Window {
    yagentDesktop?: {
      platform: string
      versions: {
        electron: string | undefined
        chrome: string | undefined
        node: string | undefined
      }
      settings?: {
        read(): Promise<string | null>
        write(content: string): Promise<void>
      }
      usage?: {
        read(): Promise<string | null>
        write(content: string): Promise<void>
      }
      insights?: {
        write(insight: import('@yagent/core').Insight): Promise<void>
        read(id: string): Promise<import('@yagent/core').Insight | null>
        readMany(ids: string[]): Promise<import('@yagent/core').Insight[]>
        listSight(): Promise<import('@yagent/core').Insight[]>
        delete(id: string, opts?: { preserveSight?: boolean }): Promise<void>
        deleteMany(ids: string[], opts?: { preserveSight?: boolean }): Promise<void>
      }
      conversations?: {
        list(): Promise<{ key: string; text: string }[]>
        append(key: string, lines: string): Promise<void>
        write(key: string, content: string): Promise<void>
        delete(key: string): Promise<void>
      }
      projects?: {
        /** 已登记项目工作目录（含删光会话的空项目） */
        list(): Promise<string[]>
        remember(workdir: string): Promise<void>
        forget(workdir: string): Promise<void>
      }
      /** 纯 chat 沙箱：local-process 已实现；docker / remote 预留 */
      sandbox?: {
        ensure(convId: string): Promise<{
          backend: 'local-process' | 'docker' | 'remote'
          root: string
        }>
        info(convId: string): Promise<{
          backend: 'local-process' | 'docker' | 'remote'
          root: string
          ready: boolean
        }>
      }
      tools?: {
        execute(name: string, input: Record<string, unknown>, workdir: string): Promise<string>
      }
      dialog?: {
        selectDirectory(): Promise<string | null>
      }
      shell?: {
        /** 系统默认浏览器打开 http(s) */
        openExternal(url: string): Promise<{ ok: boolean; error?: string }>
      }
      storage?: {
        usage(): Promise<{
          ok: boolean
          error?: string
          root: string
          totalBytes: number
          entries: {
            name: string
            rel: string
            bytes: number
            kind: 'dir' | 'file'
            children?: {
              name: string
              rel: string
              bytes: number
              kind: 'dir' | 'file'
            }[]
          }[]
        }>
        reveal(): Promise<{ ok: boolean; error?: string; root?: string }>
      }
      ssh?: {
        listHosts(): Promise<{ host: string; hostname?: string; user?: string; port?: string }[]>
        listDirs(
          host: string,
          dir: string,
        ): Promise<{ ok: boolean; dirs: string[]; cwd: string; error?: string }>
        mkdir(
          host: string,
          parent: string,
          name: string,
        ): Promise<{ ok: boolean; path?: string; error?: string }>
        ping(host: string): Promise<{ ok: boolean; error?: string }>
      }
      fs?: {
        list(workdir: string, rel: string): Promise<{ name: string; isDir: boolean; size: number }[]>
        read(
          workdir: string,
          rel: string,
        ): Promise<
          | { kind: 'text'; content: string }
          | { kind: 'html'; content: string; baseHref?: string }
          | { kind: 'markdown'; content: string }
          | { kind: 'molecule'; format: string; content: string }
          | { kind: 'image'; mime: string; dataUrl: string }
          | { kind: 'pdf'; dataUrl: string }
          | { kind: 'unavailable'; reason: string; size: number }
        >
        write(workdir: string, rel: string, base64: string): Promise<string>
        /** 打开方式菜单：可打开该文件的应用列表 */
        openMenu(
          workdir: string,
          rel: string,
        ): Promise<{
          ok: boolean
          error?: string
          localPath?: string
          folder?: string
          apps: { id: string; name: string; path: string; isDefault: boolean; iconDataUrl?: string }[]
          systemIcons?: { reveal?: string; terminal?: string }
        }>
        /** 用指定应用或系统默认打开；远程会先下载到临时文件 */
        openWithApp(
          workdir: string,
          rel: string,
          appPath?: string | null,
        ): Promise<{ ok: boolean; error?: string }>
        revealInFolder(workdir: string, rel: string): Promise<{ ok: boolean; error?: string }>
        openParentInTerminal(workdir: string, rel: string): Promise<{ ok: boolean; error?: string }>
        /** 另存为：附件用 absPath；产物用 workdir(沙箱根)+rel */
        exportFile(opts: {
          workdir?: string
          rel?: string
          absPath?: string
          defaultName?: string
        }): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
      }
      attachments?: {
        /** 写入 dataDir：projects/<slug>/uploads/<convId>/ 或 chats/uploads/<convId>/，返回绝对路径 */
        write(
          convId: string,
          name: string,
          base64: string,
          workdir?: string | null,
        ): Promise<string>
        /** 删除会话时级联清 uploads/<convId>/，并可删登记过的绝对路径 */
        purge(
          convId: string,
          workdir?: string | null,
          extraPaths?: string[],
        ): Promise<void>
      }
      /** 技能：<dataDir>/skills/<id>/SKILL.md（L1 list；L2/L3 经 tools load_skill） */
      skills?: {
        root(): Promise<string>
        list(): Promise<
          {
            id: string
            name: string
            description: string
            path: string
            disableModelInvocation?: boolean
          }[]
        >
        scanExternal(): Promise<{
          sources: {
            id: string
            label: string
            root: string
            exists: boolean
            skills: {
              id: string
              name: string
              description: string
              path: string
              disableModelInvocation?: boolean
              installed: boolean
            }[]
          }[]
        }>
        importExternal(input: {
          sourcePath: string
          id?: string
          overwrite?: boolean
        }): Promise<{
          id: string
          name: string
          description: string
          path: string
          disableModelInvocation?: boolean
          overwritten?: boolean
        }>
        importZip(input: {
          zipPath?: string
          zipBase64?: string
          fileName?: string
          overwrite?: boolean
        }): Promise<
          {
            id: string
            name: string
            description: string
            path: string
            disableModelInvocation?: boolean
            overwritten?: boolean
          }[]
        >
        pickAndImport(): Promise<{
          imported: {
            id: string
            name: string
            description: string
            path: string
            disableModelInvocation?: boolean
            overwritten?: boolean
          }[]
          canceled: boolean
          errors?: string[]
        }>
        read(id: string): Promise<{
          id: string
          name: string
          description: string
          disableModelInvocation?: boolean
          body: string
          content: string
          path: string
        }>
        create(input: {
          name: string
          description?: string
          id?: string
        }): Promise<{
          id: string
          name: string
          description: string
          path: string
          disableModelInvocation?: boolean
        }>
        write(
          id: string,
          content: string,
        ): Promise<{
          id: string
          name: string
          description: string
          path: string
          disableModelInvocation?: boolean
        }>
        delete(id: string): Promise<void>
      }
      pathForFile?(file: File): string
    }
  }
}

export {}
