import type { Conversation, Settings } from '@yagent/core'

// mock 时间基准：模块加载时刻，保证相对时间显示稳定
const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function todayAt(hh: number, mm: number): number {
  const d = new Date(NOW)
  d.setHours(hh, mm, 0, 0)
  return d.getTime()
}
function yesterdayAt(hh: number, mm: number): number {
  return todayAt(hh, mm) - DAY
}
function lastMonday(): number {
  const d = new Date(NOW)
  const dow = d.getDay() || 7
  d.setDate(d.getDate() - dow - (dow === 1 ? 6 : 0))
  d.setHours(16, 40, 0, 0)
  return d.getTime()
}

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'c1',
    title: '实现用户认证模块',
    workdir: '~/yagent',
    status: 'running',
    activeNodeId: 'c1-n4a',
    nodes: {
      'c1-n1': {
        id: 'c1-n1',
        parentId: null,
        role: 'user',
        createdAt: NOW - 2 * MIN,
        blocks: [
          {
            type: 'text',
            text: '给项目加上用户认证，用 JWT，要有登录和注册接口，密码加盐哈希存储。',
          },
        ],
      },
      'c1-n2': {
        id: 'c1-n2',
        parentId: 'c1-n1',
        role: 'agent',
        createdAt: NOW - 2 * MIN + 20_000,
        blocks: [
          {
            type: 'text',
            text: '我看了下项目结构，认证可以走两种方案：JWT 无状态、实现轻；Session + Redis 可控性强、服务端能踢下线。你倾向哪种？',
          },
        ],
      },
      'c1-n3a': {
        id: 'c1-n3a',
        parentId: 'c1-n2',
        role: 'user',
        createdAt: NOW - 2 * MIN + 40_000,
        blocks: [{ type: 'text', text: '用 JWT，加盐哈希。' }],
      },
      'c1-n3b': {
        id: 'c1-n3b',
        parentId: 'c1-n2',
        role: 'user',
        createdAt: yesterdayAt(18, 12),
        blocks: [{ type: 'text', text: '先别定，试试 Session + Redis 的方案看看。' }],
      },
      'c1-n4a': {
        id: 'c1-n4a',
        parentId: 'c1-n3a',
        role: 'agent',
        createdAt: NOW - MIN,
        blocks: [
          {
            type: 'text',
            text: '好的。我先看一下项目现有的结构，确认路由和数据库层的写法，再按这个顺序实施：\n1. 安装 `jsonwebtoken` 和 `bcrypt`\n2. 新增 `auth` 模块（注册 / 登录 / 中间件）\n3. 给现有路由挂载鉴权中间件\n\n我查了一下当前的推荐做法：refresh token 轮换能显著降低泄露风险[1]，token 建议放在 httpOnly cookie 而不是 localStorage[2]。',
          },
          {
            type: 'thinking',
            status: 'done',
            durationMs: 4200,
            text: '用户要求 JWT 认证。先确认项目里没有现成的 auth 逻辑——从目录结构看，packages/core 是放业务逻辑的正确位置。\n\nbcrypt 比 argon2 生态更成熟且够用，选 bcrypt。token 有效期定 7 天，配合 refresh token 轮换，平衡安全性和体验。',
          },
          {
            type: 'tool',
            tool: 'Bash',
            summary: 'pnpm add jsonwebtoken bcrypt',
            status: 'done',
            stats: '3.2s',
          },
          {
            type: 'tool',
            tool: 'Edit',
            summary: 'packages/core/src/auth.ts',
            status: 'done',
            stats: '+86',
            detail:
              "+ import jwt from 'jsonwebtoken'\n+\n+ export function signToken(userId: string) {\n+   return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '7d' })\n+ }\n  \n- // TODO: auth not implemented",
          },
          {
            type: 'tool',
            tool: 'Bash',
            summary: 'pnpm test auth',
            status: 'running',
          },
          {
            type: 'thinking',
            status: 'streaming',
            text: '正在等待测试结果，然后根据结果决定是否调整中间件顺序…',
          },
        ],
      },
      'c1-n4b': {
        id: 'c1-n4b',
        parentId: 'c1-n3b',
        role: 'agent',
        createdAt: yesterdayAt(18, 14),
        blocks: [
          {
            type: 'text',
            text: '好，这条分支我评估了 Session + Redis：需要额外引入 Redis 依赖，会话状态集中存储，好处是服务端可以主动踢人、踢设备，适合多端登录管控。\n\n对比下来：JWT 无状态、实现轻；Session 可控性强但多一个组件。如果后续要做“踢下线”功能，Session 更合适。',
          },
        ],
      },
    },
    refs: [
      {
        id: 1,
        title: 'Refresh Token Rotation: Best Practices',
        url: 'auth0.com/blog/refresh-tokens-what-are-they',
        snippet:
          'Refresh token rotation 通过每次使用后作废旧 token 并签发新 token 来降低长期凭证泄露的风险……',
      },
      {
        id: 2,
        title: 'Where to Store JWTs: Cookie vs localStorage',
        url: 'stackoverflow.com/questions/...cookies-vs-localstorage',
        snippet:
          'httpOnly cookie 可以免疫 XSS 读取 token，但需要额外处理 CSRF；localStorage 实现简单但容易被注入脚本窃取……',
      },
      {
        id: 3,
        title: 'RFC 7519 — JSON Web Token (JWT)',
        url: 'datatracker.ietf.org/doc/html/rfc7519',
        snippet:
          'JSON Web Token (JWT) is a compact, URL-safe means of representing claims to be transferred between two parties…',
      },
      {
        id: 4,
        title: 'The Ultimate Guide to handling JWTs on frontend clients',
        url: 'blog.logrocket.com/jwt-auth-best-practices',
        snippet: 'GraphQL 或 REST 场景下 JWT 的存储、过期与静默刷新的完整实践指南……',
      },
    ],
    attachments: [
      { name: '认证需求.pdf', size: 2.4 * 1024 * 1024 },
      { name: '登录页参考.png', size: 812 * 1024 },
      { name: '用户表结构.csv', size: 18 * 1024 },
    ],
    outputs: [
      { name: 'packages/core/src/auth.ts', size: 2.1 * 1024 },
      { name: 'packages/core/src/auth.test.ts', size: 3.4 * 1024 },
      { name: '登录页截图.png', size: 1.1 * 1024 * 1024 },
      { name: '实施报告.md', size: 6.2 * 1024 },
    ],
  },
  {
    id: 'c2',
    title: '修复支付回调超时',
    workdir: '~/pay-service',
    status: 'waiting',
    activeNodeId: 'c2-n2',
    nodes: {
      'c2-n1': {
        id: 'c2-n1',
        parentId: null,
        role: 'user',
        createdAt: NOW - 66 * MIN,
        blocks: [{ type: 'text', text: '支付回调偶发超时，帮我查一下原因并修复。' }],
      },
      'c2-n2': {
        id: 'c2-n2',
        parentId: 'c2-n1',
        role: 'agent',
        createdAt: NOW - 65 * MIN,
        blocks: [
          {
            type: 'text',
            text: '我定位到了问题：回调处理里数据库事务包住了第三方支付请求，连接池被占满导致超时。\n\n修复需要调整事务边界，这会改动 `orders.ts` 的核心流程。要我先在测试环境验证吗？',
          },
        ],
      },
    },
    refs: [],
    attachments: [{ name: '回调超时堆栈.log', size: 42 * 1024 }],
    outputs: [],
  },
  {
    id: 'c3',
    title: '重构 API 错误处理',
    workdir: '~/yagent',
    status: 'done',
    activeNodeId: 'c3-n2',
    nodes: {
      'c3-n1': {
        id: 'c3-n1',
        parentId: null,
        role: 'user',
        createdAt: todayAt(14, 2),
        blocks: [{ type: 'text', text: 'API 的错误处理太乱了，统一重构一下。' }],
      },
      'c3-n2': {
        id: 'c3-n2',
        parentId: 'c3-n1',
        role: 'agent',
        createdAt: todayAt(14, 20),
        durationMs: 372_000,
        blocks: [
          {
            type: 'text',
            text: '完成了。所有路由统一走新的 `ApiError` 体系：错误码、用户提示、日志三件事在一处定义，28 个调用点已迁移，测试全部通过。',
          },
          { type: 'tool', tool: 'Bash', summary: 'pnpm test', status: 'done', stats: '46 passed' },
          {
            type: 'artifacts',
            items: [
              {
                id: 'a1',
                name: 'api-errors-refactor.html',
                kind: 'html',
                size: 96 * 1024,
                createdAt: todayAt(14, 20),
              },
            ],
          },
        ],
      },
    },
    refs: [],
    attachments: [],
    outputs: [
      { name: 'api-errors-refactor.html', size: 96 * 1024 },
      { name: 'packages/core/src/errors.ts', size: 4.8 * 1024 },
    ],
  },
  {
    id: 'c4',
    title: '添加深色模式支持',
    workdir: '~/yagent',
    status: 'done',
    activeNodeId: 'c4-n2',
    nodes: {
      'c4-n1': {
        id: 'c4-n1',
        parentId: null,
        role: 'user',
        createdAt: todayAt(11, 5),
        blocks: [{ type: 'text', text: '界面加一套深色模式，跟随系统切换。' }],
      },
      'c4-n2': {
        id: 'c4-n2',
        parentId: 'c4-n1',
        role: 'agent',
        createdAt: todayAt(11, 18),
        durationMs: 205_000,
        blocks: [
          {
            type: 'text',
            text: '已完成。所有颜色抽成 CSS 变量，亮/暗两套主题通过 `data-theme` 切换，选择持久化到 localStorage，默认跟随 `prefers-color-scheme`。',
          },
        ],
      },
    },
    refs: [],
    attachments: [],
    outputs: [{ name: 'src/theme.css', size: 3.1 * 1024 }],
  },
  {
    id: 'c5',
    title: '数据库迁移脚本',
    workdir: '~/yagent',
    status: 'done',
    activeNodeId: 'c5-n2',
    nodes: {
      'c5-n1': {
        id: 'c5-n1',
        parentId: null,
        role: 'user',
        createdAt: yesterdayAt(16, 30),
        blocks: [{ type: 'text', text: '写一个数据库迁移脚本，把用户表加上 email 唯一索引。' }],
      },
      'c5-n2': {
        id: 'c5-n2',
        parentId: 'c5-n1',
        role: 'agent',
        createdAt: yesterdayAt(16, 44),
        durationMs: 148_000,
        blocks: [
          {
            type: 'text',
            text: '迁移脚本已生成并通过演练环境验证：`migrations/004_user_email_unique.sql`，支持回滚。',
          },
        ],
      },
    },
    refs: [],
    attachments: [],
    outputs: [{ name: 'migrations/004_user_email_unique.sql', size: 1.2 * 1024 }],
  },
  {
    id: 'c6',
    title: '首页性能优化',
    workdir: null,
    status: 'done',
    activeNodeId: 'c6-n2',
    nodes: {
      'c6-n1': {
        id: 'c6-n1',
        parentId: null,
        role: 'user',
        createdAt: lastMonday(),
        blocks: [{ type: 'text', text: '首页首屏有点慢，帮我分析一下瓶颈在哪。' }],
      },
      'c6-n2': {
        id: 'c6-n2',
        parentId: 'c6-n1',
        role: 'agent',
        createdAt: lastMonday() + 9 * MIN,
        durationMs: 96_000,
        blocks: [
          {
            type: 'text',
            text: '瓶颈主要在三处：首屏 JS 体积 1.8MB（建议路由级分包）、未开启图片懒加载、字体文件阻塞渲染。按优先级处理预计 LCP 可从 4.1s 降到 1.9s。',
          },
        ],
      },
    },
    refs: [],
    attachments: [],
    outputs: [],
  },
]

export const MOCK_SETTINGS: Settings = {
  apiKeys: { anthropic: 'sk-ant-••••••••••••••••••••' },
  models: [
    {
      id: 'm-claude',
      name: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      context: 200_000,
      isDefault: true,
    },
    {
      id: 'm-gpt',
      name: 'GPT-5 mini',
      provider: 'openai',
      modelId: 'gpt-5-mini',
      context: 128_000,
    },
    {
      id: 'm-deepseek',
      name: 'DeepSeek V4',
      provider: 'deepseek',
      modelId: 'deepseek-v4',
      context: 128_000,
    },
  ],
  memories: [
    {
      id: 'mem1',
      text: '用户偏好中文回复，代码注释用英文',
      sourceCount: 3,
      updatedAt: NOW - 2 * DAY,
    },
    {
      id: 'mem2',
      text: '包管理器固定使用 pnpm，不用 npm',
      sourceCount: 1,
      updatedAt: NOW - 5 * DAY,
    },
  ],
  tools: { terminal: true, fileEdit: true, webSearch: false },
  sandbox: { env: 'sandbox', workdir: '~/yagent', network: true },
}

export const MOCK_REPLY =
  '收到。这是设计稿的模拟回复——接入真实模型后，这里会流式输出实际内容，工具调用和产物也会实时追加在下方。'
