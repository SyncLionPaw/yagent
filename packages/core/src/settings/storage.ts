/* ============ 设置存储接口：平台无关，读原始 JSON 文本 ============ */

export interface SettingsStorage {
  read(): Promise<string | null> // 原始 JSON 文本；不存在返回 null
  write(content: string): Promise<void>
}
