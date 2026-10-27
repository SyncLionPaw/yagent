# yagent 设计稿定稿（v1.0）

> 高保真原型见 `design/index.html`（浏览器直接打开，所有交互可点）。
> 本文档是实现的唯一依据；与原型的视觉/行为冲突时以本文档为准。

## 1. 产品定位与设计原则

yagent 是一个 AI Agent 客户端（桌面 + Web 为主，移动端后置）。核心概念：

- **会话（Chat）**：一个任务单位。每个会话必有沙箱，可绑定一个工作目录（也可不绑定）。
- **对话即节点树**：会话不是一维消息列表，而是可分叉的节点树（见 §8 数据模型）。
- **Artifacts**：Agent 完成任务后产出的可交付物（代码、文档、网页、图片）。

设计原则：

1. **简洁清透**：无厚重卡片堆叠，分区靠留白与层级，不靠边框线
2. **三层图层**：底层底色（左右栏）→ 中层舞台（对话区）→ 上层浮层（弹窗/语音/下拉）
3. **过程可审计**：thinking、工具调用、分支历史都可展开查看，但默认不抢视线
4. **状态即视觉**：运行中/等待/完成等状态有明确、克制的视觉表达

## 2. 布局结构

### 2.1 总体

```
┌──────────────────────────────────────────────────┐
│  Sidebar   │   Stage（悬浮圆角卡片）   │  Panel   │
│  (底层)     │   ┌────────────────┐    │  (底层)   │
│            │   │ Topbar         │    │           │
│            │   ├────────────────┤    │           │
│            │   │ Chat           │    │           │
│            │   ├────────────────┤    │           │
│            │   │ Composer       │    │           │
│            │   └────────────────┘    │           │
└──────────────────────────────────────────────────┘
```

- 应用根容器：`display: flex; padding: 10px 10px 10px 0; gap: 10px; height: 100vh`
- **Sidebar / Panel 透明无边框**，直接"长"在底层底色上
- **Stage 是唯一的中层卡片**：圆角 16px、1px 半透明边框、柔和投影（--shadow-stage）、`overflow: hidden`

### 2.2 尺寸规范

| 项 | 值 |
|---|---|
| Sidebar 宽 | 236px |
| Panel 宽 | 288px |
| Stage 圆角 | 16px（内部卡片 10px，输入框 16px，按钮 7-9px） |
| Topbar 高 | 56px |
| 对话内容最大宽 | 700px，居中 |
| 间距基准 | 4 / 8 / 10 / 14 / 20px |

### 2.3 面板折叠（左右对称）

- 收起通过负 margin 滑出视口（`margin-left: -236px` / `margin-right: -298px`），配合 `opacity` 渐变，transition 0.22s ease
- 舞台随 flex 弹性伸缩，动画期间顶栏控件不变形（见 §6.4）
- **开关按钮只在 Stage 顶栏**：左侧一个（侧栏，⌘B）、右侧一个（面板）。左右栏自身不带开关按钮
- Panel 默认收起；Sidebar 默认展开

## 3. 主题系统

亮/暗双主题，通过 `<html data-theme="light|dark">` 切换，全部颜色走 CSS 变量。切换入口在左下角工作区卡片内（图标按钮），选择持久化到 localStorage，默认跟随 `prefers-color-scheme`。

| Token | Light | Dark |
|---|---|---|
| --bg-app（底层） | #eef0f4 | #131318 |
| --bg-surface（舞台/卡片） | #ffffff | #1d1d24 |
| --bg-hover | rgba(0,0,0,.04) | rgba(255,255,255,.05) |
| --bg-active | rgba(0,0,0,.055) | rgba(255,255,255,.08) |
| --bg-bubble（用户气泡） | #eef0f4 | #2b2b34 |
| --bg-code | #f4f5f8 | #23232b |
| --border | rgba(0,0,0,.06) | rgba(255,255,255,.06) |
| --border-strong | rgba(0,0,0,.11) | rgba(255,255,255,.12) |
| --text-0 / 1 / 2 | #1c1c21 / #5b5b66 / #9a9aa5 | #ececf1 / #a0a0ac / #63636e |
| --accent | #6c5ce7 | #8b7cf6 |
| --accent-text | #5a4bd1 | #9d8ffb |
| --accent-soft | rgba(108,92,231,.09) | rgba(139,124,246,.13) |
| --green / --yellow / --red / --blue | #0e9f6e / #b07d2b / #d64545 / #2f7de1 | #34c68a / #d4a24e / #e06c6c / #6aa5f8 |

状态色语义：绿=成功/运行中，黄=等待，红=错误/删除。**完成状态等弱提示一律用 --text-2，不用彩色。**

## 4. 字体与图标

- 正文字体：系统栈 `-apple-system, "SF Pro Text", "PingFang SC", sans-serif`；正文 14px/1.65
- 等宽字体（代码、路径、时间、元信息）：`"SF Mono", "JetBrains Mono", Menlo, monospace`，11-12.5px
- 图标：Lucide 线性图标（React 落地用 `lucide-react`），统一 stroke-width 1.75、尺寸 13px（ic-sm）/15px（ic）
- 模型厂商图标：@lobehub/icons（Apache 2.0），品牌色固定；OpenAI 用 currentColor 跟随主题
- **禁止使用 emoji 或文字符号充当图标**

## 5. 组件详述

### 5.1 Sidebar（左侧栏）

- 头部：文字标 **y**agent（y 用 --accent-text）
- 「新建任务」按钮：白底（--bg-surface）+ 细边框 + 右侧 ⌘N kbd 提示
- 会话列表分组：进行中 / 今天 / 更早
  - 每行：状态点（6px 圆点：绿=运行中带呼吸动画，黄=等待，灰=已完成）+ 标题（截断）+ 相对时间
  - 选中行：--bg-active 背景；hover：--bg-hover
  - 点击切换中间会话视图 + 顶栏标题/目录（见 §5.3）
- 底部工作区卡片：头像 + 工作区名/路径 + 右侧主题按钮和设置按钮
  - **整块可点**打开设置（设置按钮只是视觉提示）；hover 有 --bg-hover 反馈，active 更深
  - 主题按钮独立（阻止冒泡）

### 5.2 Topbar（舞台顶部）

从左到右：

1. 侧栏开关按钮（panel-left 图标，⌘B）
2. **会话标题：就地可编辑**。点击即进入编辑态（hover 浅灰底、focus 紫描边白底）；Enter/失焦保存并同步左侧列表；Esc 取消；空值回退原标题；IME 组词期间 Enter 不触发
3. `·` 分隔点 + **工作目录**：文件夹图标 + 等宽字体路径（如 `~/yagent`）；无目录的纯聊天显示对话气泡图标 + `chat`
4. 右侧（flex-shrink: 0，永不变形）：
   - 沙箱状态胶囊（绿点 + "沙箱已连接"，pill 灰底）
   - **模型选择**：纯图标按钮（当前模型厂商 logo），点击下拉列表（厂商图标 + 名称 + provider·上下文，当前项对勾），选中换图标
   - **分享按钮**（link 图标）：弹层含说明（只读快照、不可操作）+ 只读链接输入框 + 纯图标复制按钮（点击后变绿勾 1.6s）
   - **归档** / **删除对话**（确认后删 JSONL 并级联清 uploads，见 §13）
   - 右面板开关按钮（panel-right 图标）

### 5.3 ChatView（对话区）

- 内容 = 当前会话从根到 activeNodeId 的路径（见 §8）
- 消息类型：
  - **用户**：右对齐气泡（--bg-bubble，圆角 14px），头部右侧"你 + 时间"
  - **Agent**：无框正文，头部"yagent（紫色）+ 时间"
- **thinking 块**：
  - 流式中：spinner + 灰色小字，单行滚动
  - 完成后：折叠为一行"灯泡图标 + 思考过程 · 用时 + 右箭头"，点击展开为左竖线引用块（灰字小一号）
- **工具调用卡片**：单行极简——图标 + 工具名（蓝色等宽）+ 描述 + 右侧状态（✓ 3.2s / spinner 运行中 / +86）；点击展开详情（命令输出、diff）
  - diff 渲染：等宽 11.5px，+ 行绿色、- 行红色、上下文灰色
- **引用角标（ref）**：模型在正文插入 `<ref url="https://…" title="短标题">摘要</ref>`（或 `<ref_link>url</ref_link>`）；客户端写入 `conversation.refs`，展示为紫色 `[n]`；点击 → 展开右栏「搜索」并高亮来源卡片。裸 `[1]` 无标签时右栏不会有条目。
- **Artifact 大卡片**（回答完成后挂在回答底部）：
  - 整行宽卡片：42px 类型缩略块 + 粗体文件名 + 类型行 + 右侧"…"菜单
  - 卡片下方同排：操作按钮组（复制/赞/踩/分享/下载/更多）+ 最右灰色小字"已完成 · 用时 xx"
  - **点击卡片是开关式**：展开右栏文件页；再点关闭右栏；右栏开着但停在别的页则先切到文件页
- **状态条**：
  - 等待确认：黄点 + "等待你的确认后…"
  - 分支暂停：黄点 + "此分支已暂停 · 点击节点回到当前分支"

### 5.4 Topbar/输入区的窄屏降级（容器查询）

- Stage ≤ 720px：隐藏目录分隔符与目录
- Stage ≤ 560px：隐藏状态胶囊
- 标题始终可压缩（ellipsis），右侧控件组永不换行收缩
- 输入框 ≤ 480px：工具栏 chip 只留图标隐藏文字

### 5.5 Composer（输入区）

- 悬浮圆角卡片（16px 圆角 + 大投影），focus 时紫描边
- **textarea 自适应高度**：随内容长高，上限 180px，超出内滚；发送后复位
- **发送**：⌘/Ctrl + Enter 发送；Enter 换行；IME 组词（isComposing / keyCode 229）期间 Enter 不触发
- 发送按钮：矩形紫底，command 键图标 + "+" + 回车键图标（纯 SVG，无文字）
- **附件**：支持粘贴 / 拖入；待发送卡片浮在输入框上方（见 §13）
- 工具栏 chip：模式选择器 / 附件 / @引用文件 / **自动执行**（开则跳过 `write_file` / `run_command` 审批；写入 `settings.tools.autoApprove`，桌面进 `settings.json`） / **麦克风** / 发送
- **模式选择器**（chip，向上弹出）：
  - 纯对话（不执行任何操作）
  - Work · 本地沙箱（本机隔离沙箱执行）
  - Work · 云端远程（云端运行，手机可接管）——选中后输入框上方出现紫色提示条"远程控制已开启，手机端可接管此会话 + 连接手机入口"
- **语音输入**：点击麦克风进入语音悬浮层（见 §7）

### 5.6 RightPanel（右侧面板）

顶部标签页：分支 / 文件 / 搜索。

- **分支**：git 风格节点树（SVG 连线 + 泳道），见 §5.6.1
- **文件**：上下两个半区（各 50% 高，中间 1px 间隔线，各自滚动）：
  - 上：用户附件（上传的文件：图标 + 名 + 大小；落盘与投喂策略见 §13）
  - 下：Agent 产物（本次任务生成的文件）
  - 底部虚线框说明："仅展示你上传的附件和 Agent 产出的文件，不是完整的沙箱文件系统"
- **搜索**：来源卡片列表（编号 + 标题 + URL + 摘要）
- **浏览器**（按需出现在搜索右侧）：内嵌 iframe + 地址栏；从搜索点卡片或正文 `[n]` 打开后才显示该 tab；tab 上有 ✕ 可关掉（关后 tab 消失，回到搜索）；面包屑可回搜索；可刷新 / 外链（禁嵌站点兜底）

#### 5.6.1 分支树渲染规则

- 左侧 SVG 图区（泳道 x 间距 20px，行高 44px），右侧标签列
- 边：同泳道直线，跨泳道用三次贝塞尔曲线；当前路径紫色，其余灰色
- 节点圆点 r=4.5：绿=用户，紫=Agent；当前节点带紫色光晕外圈
- 分叉即一个节点有多个 children，分别进入新泳道
- **点击节点**：高亮为当前节点；若节点属于某个分支，对话区切换加载该分支的路径内容；主干节点点击只改高亮

### 5.7 SettingsModal（设置弹窗）

- 打开：点击左下角工作区卡片（整块）；关闭：✕ / Esc / 点遮罩
- 布局：左 168px 标签导航 + 右内容区，720×520，居中模态
- 三个标签：
  1. **API 密钥（BYOK）**：Anthropic / OpenAI / 自定义端点（OpenAI 兼容），密码框输入；保存 + 测试连接 + 连通状态标签；文案"密钥仅存储在本地"
  2. **模型配置**：已配置模型列表（名称 + provider·model-id·上下文 + 默认标记 + 删除）；底部添加表单（显示名称 / 提供商 / 模型 ID）
  3. **记忆与工具**：
     - 记忆列表（内容 + 来源会话数 + 更新时间 + 逐条删除）
     - 默认工具开关（终端命令 / 文件编辑 / 网络搜索）+ 网络内容后端（Bing / DeepSeek）
     - 沙箱：执行环境分段选择（本地直连 / 隔离沙箱）+ 工作目录 + 沙箱网络开关

### 5.8 弹层互斥规则

模型下拉、分享弹层、模式弹层三者互斥：打开任何一个先关闭其他两个；点击弹层内部不冒泡；点击页面其他处全部关闭。

## 6. 语音输入

- 入口：Composer 工具栏麦克风图标
- 进入后：**悬浮层覆盖整个舞台**（毛玻璃模糊 + 轻压暗，z-index 高于对话低于模态），输入框原地不动不撑高
- 悬浮层内容（垂直居中）：
  - **声纹波浪**：48 根 3px 渐变细柱（浅紫→主紫，带辉光），高 72px 容器
  - 红点 + 计时（等宽字体）
  - 实时识别文本（15px，居中，带闪烁光标，max-width 520px）
  - 取消（✕）/ 完成（✓）圆形按钮
- **真实驱动**（不再使用演示假文案）：
  - `getUserMedia` + `AnalyserNode`（fftSize 64，smoothing 0.72），rAF 频谱柱 + 音量呼吸
  - **Chrome / 支持 Web Speech 的浏览器**：`SpeechRecognition`（zh-CN，continuous + interimResults）实时字幕
  - **Electron 桌面**：Chromium 无 Google 语音服务；`MediaRecorder` 录音后走可切换 ASR（设置 → 工具 → 语音识别）：
    - **Groq**（推荐，免 OpenAI）：`whisper-large-v3-turbo`，OpenAI 兼容接口，有免费档
    - **OpenAI Whisper**：`whisper-1`
    - **本地**：FunASR / SenseVoice 等提供 `/v1/audio/transcriptions` 的服务（DeepSeek Harness 同思路；**DeepSeek API 本身无 ASR**）
  - macOS 启动时 `askForMediaAccess('microphone')`
  - 未配置时明确提示，不灌假字
- 完成：识别文本回填输入框，用户可编辑后再发送（**绝不直接发送**）
- 取消/完成/Esc：停止识别、关闭麦克风流、关闭 AudioContext、收起悬浮层

## 7. 分享

- 顶栏分享按钮 → 弹层：说明（获得链接者只读查看当前分支，不可操作）+ 只读链接 + 图标复制按钮
- 链接语义：**当前分支的只读快照**（`/s/{convId}-{snapshotId}`），分享后的后续对话不影响快照

## 8. 数据模型（TypeScript，放 @yagent/core）

```ts
type Role = 'user' | 'agent'

// 会话节点：树结构
interface ConversationNode {
  id: string
  parentId: string | null      // 分叉 = 一个节点多个 children
  role: Role
  blocks: Block[]
  createdAt: number
  durationMs?: number          // agent 节点耗时
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; name: string; path?: string; data: string } // 用户附图，多模态回放
  | { type: 'thinking'; text: string; status: 'streaming' | 'done'; durationMs?: number }
  | { type: 'tool'; tool: string; summary: string; status: 'running' | 'done' | 'error'; detail?: string; stats?: string }
  | { type: 'artifacts'; items: Artifact[] }

interface Ref { id: number; title: string; url: string; snippet: string }

interface Artifact {
  id: string
  name: string
  kind: 'code' | 'doc' | 'html' | 'image'
  size: number
  createdAt: number
}

interface Conversation {
  id: string
  title: string                 // 顶栏可改名
  workdir: string | null        // null = 纯 chat（顶栏显示 "chat"）
  nodes: Record<string, ConversationNode>
  activeNodeId: string
  status: 'running' | 'waiting' | 'done'
  refs: Ref[]
  attachments: SandboxFile[]    // 用户附件
  outputs: SandboxFile[]        // Agent 产物
}

type Mode = 'chat' | 'local' | 'cloud'

interface Settings {
  apiKeys: { anthropic?: string; openai?: string; customEndpoint?: string; customKey?: string }
  models: { id: string; name: string; provider: string; modelId: string; context: number; isDefault?: boolean }[]
  memories: { id: string; text: string; sourceCount: number; updatedAt: number }[]
  tools: {
    terminal: boolean
    fileEdit: boolean
    webSearch: boolean
    autoApprove?: boolean
    /** search_web / fetch_url 后端，默认 bing */
    webProvider?: 'bing' | 'deepseek'
  }
  sandbox: { env: 'local' | 'sandbox'; workdir: string; network: boolean }
}
```

## 9. 快捷键

| 键 | 作用 |
|---|---|
| ⌘/Ctrl + Enter | 发送 |
| Enter | 输入框换行 |
| ⌘B | 收起/展开左侧栏 |
| Esc | 关闭设置弹窗 / 退出语音 |

## 10. 落地映射（React）

- 样式：设计稿 CSS 变量与语义 className 原样迁入全局 CSS；Tailwind 用于新增布局
- 组件：`Sidebar / Topbar(EditableTitle, ModelPicker, ShareButton) / ChatView(MessageList, ToolCard, ThoughtBlock, RefLink, ArtifactCard) / Composer(ModeSelector, VoiceOverlay) / RightPanel(BranchTree, FilesPane, SearchPane) / SettingsModal`
- 状态：`activeConversationId` + `activeNodeId` 驱动中间区；`openPopover` 单状态实现弹层互斥；主题 useState + localStorage
- 分支树组件数据驱动：输入 nodes 树 → 自动分配泳道/行 → 生成 SVG path（设计稿中为手工坐标）

## 11. 可插拔 Provider

### 11.1 网络内容（search_web / fetch_url）

主进程执行，接口与实现分离（`apps/desktop/src/web-content/`）：

```ts
interface WebContentProvider {
  readonly id: 'bing' | 'deepseek'
  search(query: string, signal?: AbortSignal): Promise<string>
  fetch(url: string, signal?: AbortSignal): Promise<string>
}
```

| id | 行为 | 鉴权 |
|---|---|---|
| `bing`（默认） | Bing 结果页 HTML 解析 + 直连 URL 粗去标签 | 无 |
| `deepseek` | `POST /v1/tools/search` + `/v1/tools/fetch`（[官方文档](https://api-docs.deepseek.com/zh-cn/guides/search)） | 复用 settings 里 DeepSeek 模型条目的 `apiKey` |

由 `settings.tools.webProvider` 切换；设置页「工具 → 网络内容后端」。工具名对模型始终是 `search_web` / `fetch_url`，换后端不改 tool schema。

### 11.2 沙箱方案（后置）

沙箱执行环境本期不实现，但架构上按**可插拔 Provider** 设计：

```ts
interface SandboxProvider {
  exec(cmd: string, cwd?: string): Promise<ExecResult>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  // ...
}
```

候选后端：本地直连（开发态默认）/ e2b / 其他云端沙箱服务。UI 层的"沙箱已连接"状态、文件页、模式选择（本地/云端）都面向 `SandboxProvider` 接口编程，不绑定具体实现。

## 12. 明确不做（本期）

- 移动端原生界面（PWA 顶着）
- 沙箱完整文件系统浏览（只有附件/产物两个受控视图）
- 多人协作、评论
- git 集成 UI（工作目录≠git 仓库）

## 13. 用户附件（存储与投喂）

工作目录绑定 ≠ 可往用户仓库里塞文件。附件一律落在**应用数据目录**，与会话 JSONL 同树，不污染绑定的项目。

### 13.1 落盘位置

数据根目录：

- 正式：`~/.yagent/`
- 桌面 `--dev`：仓库旁 `.yagent/`（便于清测）

技能（设置 → 技能）：`<dataDir>/skills/<id>/SKILL.md`（Cursor / Claude 风格 frontmatter：`name` / `description` / 可选 `disable-model-invocation`）。
渐进披露：启动与发消息前把可自动调用技能的 **L1**（id+name+description）写入 system；匹配任务时模型调 `load_skill(id)` 拉取 **L2** 正文，可选 `file` 读同目录 **L3** 附属文件。`disable-model-invocation: true` 的技能不进 L1 目录。
设置页支持**扫描其他 Agent 目录**（`~/.cursor/skills-cursor`、`~/.cursor/skills`、`~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills`）并**迁移/覆盖**到本机 skills；「同步到模型」刷新 L1。
Slash 命令（输入框 `/`）：本地执行、不进模型。
- `/reload_skill`：重新扫描技能目录并刷新 L1
- `/compact`：压缩当前会话上下文（占位，尚未实现；执行后提示气泡）

知识库（设置 → 知识库）：来源登记在 `settings.knowledgeBases.sources`（本地目录 / Notion / Drive 等）。本期可连接并持久化；检索 / RAG / OAuth 未接线。

| 场景 | 路径 |
|---|---|
| 绑定了工作目录 | `<dataDir>/projects/<workdir-slug>/uploads/<convId>/<ts>-<safeName>` |
| 纯对话（无 workdir） | `<dataDir>/chats/uploads/<convId>/<ts>-<safeName>` |

`workdir-slug` 与会话存储一致（`/Users/gyl/yagent` → `Users-gyl-yagent`）。同目录下另有 `<convId>.jsonl` 会话文件，以及 **`project.json`**（登记工作目录）。删光该项目下全部对话后仍保留 `project.json`，侧栏继续显示空项目（可点 + 再建任务）；仅用户主动「从列表移除」才 `projects:forget`。IPC `attachments:write` 返回**绝对路径**；删除会话时 `attachments:purge` 级联清该会话的 `uploads/<convId>/`。

### 13.2 发送时如何投喂模型

发送瞬间按类型分流（阈值写入应用目录；不写用户仓库）：

| 类型 | 条件 | 投喂方式 |
|---|---|---|
| 短文本 | ≤ **1KB** 且为可识别文本/代码 | **内容内联**进用户消息（fence），并附带绝对路径 |
| 图片 | `image/*` 或常见图片扩展名 | **多模态**：OpenAI `image_url` / Anthropic `image`（base64）；消息文案仍标注文件名与路径；round 节点在 `blocks[0]` 文本后追加 `image` block |
| 大文件 / 难解析 | 其余（PDF、压缩包、大文本等） | **只给绝对路径**，文案必须写清 `绝对路径: …`，禁止只说「请 read_file」却不给路径 |

原则：小内容直接可见；图走厂商 vision；大/二进制不灌上下文，工具按需读。落盘失败时不得暗示可按路径读取（改为内联文本或明确「未落盘」）；模型不得猜测 `.yagent/uploads/` 等错误相对路径。

### 13.3 工具读权限

- `read_file`：相对路径 → 绑定工作目录内；**绝对路径**仅允许落在应用 `uploads/`（`projects/<slug>/uploads/…` 或 `chats/uploads/…`），或仍落在绑定工作区内。无 workdir 时也可读 uploads 绝对路径。
- **分页**：`offset`（1-based 行，默认 1）+ `limit`（默认 2000 行）；单页另有约 80KB 字符上限。未读完时返回 `[PARTIAL] … Next: offset=N`，由模型续读；不再整文件读完再硬砍。
- `write_file` / `run_command`：仍仅限绑定工作目录，不可写 uploads、不可借附件目录改仓库。

### 13.4 UI

- Composer：粘贴/拖入 → 待发送卡片（缩略图/图标）；Backspace 可移除末项
- 用户消息：附件条在**气泡外上方**（右对齐），与发送区 **同一套 attach-card**：图片 / HTML / MD / 小 PDF 缩略预览，其它类型图标封面；图片可点开大图。气泡内只放用户原文
- 右栏「用户附件」：会话级登记的附件列表（名/路径/大小），不是完整沙箱文件系统
- 顶栏：归档旁提供**删除对话**；确认后删除会话 JSONL，并级联 `attachments:purge`（见 §13.1）
- 实现注意：`@yagent/core` 走 `dist/`，改 harness / messages 后需 `pnpm --filter @yagent/core build`，否则 Web/Electron 仍用旧 `sendMessage`（会丢掉多模态 `images`，只剩正文里的附件字串——表现为模型「看不见图」去 `find`/`ls`）
