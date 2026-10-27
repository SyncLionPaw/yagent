/* ============ 会话存储接口：平台无关，JSONL 文本 ============
 * key 是相对路径（core 的 conversationKey 生成）：
 *   projects/<目录slug>/<convId>.jsonl   绑定目录的任务
 *   chats/<convId>.jsonl                 纯对话
 * web 端注入 localStorage 实现，desktop 端注入 IPC 文件实现。
 * append 是主路径（只追加变脏的记录）；write 是整体重写（压缩用）。
 */

export interface ConversationStorageEntry {
  key: string
  text: string
}

export interface ConversationStorage {
  list(): Promise<ConversationStorageEntry[]> // 全部会话文件（key + JSONL 全文）
  append(key: string, lines: string): Promise<void> // 追加若干行（以 \n 结尾）；不存在则创建
  write(key: string, content: string): Promise<void> // 整体重写
  delete(key: string): Promise<void>
}
