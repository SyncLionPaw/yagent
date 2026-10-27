import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
} from 'lucide-react'
import { fileKindOf } from '../lib/utils'

const KIND_ICON = {
  image: ImageIcon,
  code: FileCode,
  doc: FileText,
  sheet: FileSpreadsheet,
  archive: FileArchive,
  media: FileAudio,
  file: File,
} as const

/** 按文件类型着色的裸图标（无方块底），右栏文件列表用 */
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const kind = fileKindOf(name)
  const Icon = kind === 'media' && /\.(mp4|mov|webm|mkv|avi)$/i.test(name) ? FileVideo : KIND_ICON[kind]
  return (
    <span className={`file-ic fi-${kind}${className ? ` ${className}` : ''}`}>
      <Icon className="ic ic-sm" />
    </span>
  )
}
