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
      tools?: {
        execute(name: string, input: Record<string, unknown>, workdir: string): Promise<string>
      }
      dialog?: {
        selectDirectory(): Promise<string | null>
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
          | { kind: 'image'; mime: string; dataUrl: string }
          | { kind: 'pdf'; dataUrl: string }
          | { kind: 'unavailable'; reason: string; size: number }
        >
        write(workdir: string, rel: string, base64: string): Promise<string>
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
    }
  }
}

export {}
