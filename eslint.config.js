import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

/** browser + node 常用全局，避免 no-undef 误报 */
const sharedGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'readonly',
  require: 'readonly',
  exports: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  fetch: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  RequestInit: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  structuredClone: 'readonly',
  NodeJS: 'readonly',
  // DOM
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  HTMLElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  Element: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  ClipboardEvent: 'readonly',
  DragEvent: 'readonly',
  FocusEvent: 'readonly',
  MessageEvent: 'readonly',
  File: 'readonly',
  FileList: 'readonly',
  FileReader: 'readonly',
  Blob: 'readonly',
  FormData: 'readonly',
  Image: 'readonly',
  ImageData: 'readonly',
  ResizeObserver: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  DOMParser: 'readonly',
  CSS: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  // React / JSX
  React: 'readonly',
  JSX: 'readonly',
}

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: sharedGlobals,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TS 已检查未定义变量；关掉 eslint 的 no-undef 避免与类型环境打架
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.jsx', '**/*.tsx'],
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: sharedGlobals,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'warn',
    },
  },
  // Electron main 仍用 CJS require
  {
    files: ['apps/desktop/src/**/*.{ts,js}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/release/**',
      '**/.tmp/**',
      'website/**',
      'apps/desktop/build/**',
      'packages/core/scripts/**',
    ],
  },
]
