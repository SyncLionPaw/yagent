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

## Contributing

1. Create a feature branch
2. Make your changes
3. Ensure tests pass: `pnpm test`
4. Ensure code quality: `pnpm lint && pnpm typecheck`
5. Submit a pull request

## License

[Add license information]
