import { ServerOff } from 'lucide-react'

export function SshOfflineBanner({
  host,
  status,
  error,
  onRetry,
}: {
  host: string
  status: 'checking' | 'fail'
  error: string
  onRetry: () => void
}) {
  return (
    <div className="ssh-offline-banner">
      <ServerOff className="ic ic-sm" />
      <span>
        {status === 'checking' ? (
          <>
            正在检测远程主机 <strong>{host}</strong>
            …仍可对话；确认连通前远程读写与命令已暂停。
          </>
        ) : (
          <>
            无法连接远程主机 <strong>{host}</strong>
            {error ? `：${error}` : ''}
            。仍可对话；远程读写与命令已暂时关闭。
          </>
        )}
      </span>
      {status === 'fail' ? (
        <button className="ssh-offline-retry" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  )
}
