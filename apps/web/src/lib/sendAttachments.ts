import type { PendingAttachment } from '../components/Composer'
import {
  INLINE_ATTACH_MAX,
  INLINE_FALLBACK_MAX,
  buildFilePreview,
  fenceLang,
  fileToBase64,
  formatAttachSize,
  imageMimeFromName,
  isImageAttach,
  isTextualAttach,
} from './attach'

export type PreparedSendAttachments = {
  saved: { name: string; size: number }[]
  modelNotes: string[]
  images: { mime: string; name: string; path?: string; data: string }[]
  fileCards: {
    name: string
    size: number
    path?: string
    mime?: string
    preview?:
      | { kind: 'html'; html: string }
      | { kind: 'md'; text: string }
      | { kind: 'pdf'; dataUrl: string }
  }[]
}

/** 落盘 + 内联说明 + 预览卡，供 sendMessage 使用 */
export async function prepareSendAttachments(
  convId: string,
  workdir: string | null | undefined,
  files: PendingAttachment[],
): Promise<PreparedSendAttachments> {
  const saved: PreparedSendAttachments['saved'] = []
  const modelNotes: string[] = []
  const images: PreparedSendAttachments['images'] = []
  const fileCards: PreparedSendAttachments['fileCards'] = []
  const writeAtt = window.yagentDesktop?.attachments?.write

  for (const a of files) {
    let absPath = ''
    let writeErr = ''
    const base64 = await fileToBase64(a.file)
    if (writeAtt) {
      try {
        absPath = await writeAtt(convId, a.name, base64, workdir)
      } catch (err) {
        writeErr = err instanceof Error ? err.message : String(err)
        console.warn('[yagent] attachments:write failed', a.name, writeErr)
      }
    } else if (window.yagentDesktop) {
      writeErr = 'attachments API 不可用（请重启桌面端以加载最新 preload）'
      console.warn('[yagent]', writeErr)
    }
    saved.push({ name: absPath || a.name, size: a.size })

    if (isImageAttach(a.file)) {
      const mime = a.file.type || imageMimeFromName(a.name)
      images.push({ mime, name: a.name, path: absPath || undefined, data: base64 })
      if (absPath) {
        modelNotes.push(
          `\n\n[附件: ${a.name} · 图片 · ${formatAttachSize(a.size)}]\n绝对路径（read_file 请原样使用，勿猜测）: ${absPath}`,
        )
      }
      continue
    }

    const preview = await buildFilePreview(a.file, a.name)
    fileCards.push({
      name: a.name,
      size: a.size,
      path: absPath || undefined,
      mime: a.file.type || undefined,
      preview,
    })
    const textual = isTextualAttach(a.file)
    const inlineFallback = !absPath && textual && a.file.size <= INLINE_FALLBACK_MAX
    const shouldInline = (textual && a.file.size <= INLINE_ATTACH_MAX) || inlineFallback
    if (shouldInline) {
      const body = (await a.file.text()).slice(0, INLINE_FALLBACK_MAX)
      const lang = fenceLang(a.name)
      const pathLine = absPath
        ? `\n绝对路径（内容已内联；一般无需再读）: ${absPath}`
        : writeErr
          ? `\n（未落盘: ${writeErr}）`
          : ''
      modelNotes.push(
        `\n\n[附件: ${a.name} · ${formatAttachSize(a.size)}]${pathLine}\n\`\`\`${lang}\n${body}\n\`\`\``,
      )
    } else if (absPath) {
      modelNotes.push(
        `\n\n[附件: ${a.name} · ${formatAttachSize(a.size)}]\n绝对路径（请用 read_file 原样读取，勿改写或猜测相对路径）: ${absPath}`,
      )
    } else {
      modelNotes.push(
        `\n\n[附件: ${a.name} · ${formatAttachSize(a.size)} · 未能保存到应用目录${writeErr ? `（${writeErr}）` : ''}，无可用路径，请根据文件名请用户重试]`,
      )
    }
  }

  return { saved, modelNotes, images, fileCards }
}
