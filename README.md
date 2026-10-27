# yagent

A modern AI agent platform with web and desktop interfaces.

## Project Structure

```
yagent/
├── apps/
│   ├── web/           # Web application (Vite + React)
│   └── desktop/       # Desktop app (Electron)
├── packages/
│   ├── core/          # Core agent logic and harness
│   └── ui/            # Shared React components
└── design/            # Design specs and prototypes
```

## Prerequisites

- Node.js >= 20
- pnpm 10.0.0

## Getting Started

1. Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd yagent
pnpm install
```

2. Copy environment variables:

```bash
cp .env.example .env
# Edit .env and add your API keys
```

3. Start development:

```bash
# Web app (default)
pnpm dev

# Desktop app
pnpm dev:desktop
```

## Development

### Available Commands

```bash
# Development
pnpm dev              # Start web dev server
pnpm dev:web          # Start web dev server
pnpm dev:desktop      # Start desktop app in dev mode

# Building
pnpm build            # Build all packages
pnpm build:web        # Build web app only
pnpm build:desktop    # Build and package desktop app

# Quality checks
pnpm lint             # Lint all code
pnpm typecheck        # Type check all packages
pnpm test             # Run tests
```

### Package Scripts

Each package has its own scripts:

- `build` - Compile TypeScript to dist/
- `typecheck` - Type check without emitting
- `dev` - Start development mode (web/desktop only)

### Architecture

- **@yagent/core**: Core agent loop, conversation management, provider integrations (Anthropic, OpenAI)
- **@yagent/ui**: Shared React components with Tailwind styling
- **apps/web**: Vite-powered web interface
- **apps/desktop**: Electron shell wrapping the web app

Design source of truth: [`design/SPEC.md`](design/SPEC.md)（含 §13 用户附件：存储路径与投喂策略）.

## Configuration

### Environment Variables

See [.env.example](.env.example) for required environment variables.

### TypeScript

This is a TypeScript monorepo with project references:
- Root [tsconfig.json](tsconfig.json) coordinates workspace
- Each package has its own tsconfig with appropriate settings

### Code Quality

- ESLint with TypeScript + React rules ([eslint.config.js](eslint.config.js))
- Vitest for testing ([vitest.config.ts](vitest.config.ts))
- GitHub Actions CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))

## Building for Production

### Web

```bash
pnpm build:web
# Output: apps/web/dist/
```

### Desktop

```bash
pnpm build:desktop
# Output: apps/desktop/release/
```

### GitHub Releases（桌面打包）

推送版本 tag 会触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)，在 macOS / Windows / Linux 上跑 `electron-builder` 并上传到 GitHub Releases：

```bash
git tag v0.1.0
git push origin v0.1.0
```

也可在 Actions 里手动跑 **Release**。当前为未签名构建（`CSC_IDENTITY_AUTO_DISCOVERY=false`）；正式分发再配 Apple/Windows 证书即可。

### 官网 / 文档（GitHub Pages）

[`website/`](website/)（含 `docs.html`）由 [`.github/workflows/pages.yml`](.github/workflows/pages.yml) 部署。

仓库设置一次即可：

1. **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
2. 推送 `main` 上对 `website/` 的改动，或手动跑 **Pages** workflow

预计地址：`https://synclionpaw.github.io/yagent/`（文档：`…/docs.html`）。

## Contributing

1. Create a feature branch
2. Make your changes
3. Ensure tests pass: `pnpm test`
4. Ensure code quality: `pnpm lint && pnpm typecheck`
5. Submit a pull request

## License

[Add license information]
