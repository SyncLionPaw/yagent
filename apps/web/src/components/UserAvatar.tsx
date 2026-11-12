/** 默认头像：Chiikawa 小八（Hachiware） */
export const DEFAULT_AVATAR_SRC = '/avatars/hachiware.jpg'

/** 侧栏 / 设置页用户头像；默认用小八，昵称首字仅作无图回退 */
export function UserAvatar({
  letter,
  className = '',
  title,
}: {
  letter?: string
  className?: string
  title?: string
}) {
  return (
    <div className={`avatar avatar-img${className ? ` ${className}` : ''}`} title={title}>
      <img src={DEFAULT_AVATAR_SRC} alt="" draggable={false} />
      <span className="avatar-fallback" aria-hidden>
        {letter || 'U'}
      </span>
    </div>
  )
}
