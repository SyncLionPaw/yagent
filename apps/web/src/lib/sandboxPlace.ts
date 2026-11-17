/** 纯 chat 顶栏上的沙箱位置。没有具体地址时不显示「远程」。 */

export function sandboxPlace(box?: { backend?: string; label?: string } | null): string | null {
  const label = box?.label?.trim()
  if (label) return label
  if (box?.backend === 'local-process') return '本机'
  return null
}
