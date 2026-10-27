# yagent Documentation

User guide for yagent, an AI agent client for web and desktop (macOS). This document mirrors the docs page on the website (`website/docs.html`).

## Getting started

yagent ships as a web app and a desktop app (macOS). From the repository root, run `pnpm install && pnpm dev` for the web app, or `pnpm dev:desktop` for the desktop app.

On first use, add your Anthropic or OpenAI key under **Settings → API keys**. OpenAI-compatible custom endpoints work too. **Keys are stored locally only** and never sent to any server.

Click **New task** (`⌘N`) in the sidebar to start your first session.

## Core concepts

- **Chat**: one unit of work. Bind it to a working directory, or keep it as a pure conversation that touches no files.
- **Three modes**: Chat only (performs no actions), Work · Local sandbox (isolated execution on your machine), Work · Cloud (runs remotely, can be taken over from your phone). Switch from the composer toolbar.
- **Conversation as a node tree**: a conversation is not a flat list of messages but a tree you can fork. If an answer disappoints, go back to any node and branch off. The Branches tab in the right panel visualizes the whole tree.
- **Artifacts**: deliverables produced by a task (code, docs, web pages, images) appear as cards below the answer; click to open them in the right panel.

## Tools & attachments

Default tools: terminal commands, file editing, and web search — each can be toggled under **Settings → Memory & tools**. Turn on **Auto-run** to skip per-action confirmation for file writes and commands.

Paste or drop attachments into the composer. Text under 1KB is inlined to the model, images go through multimodal vision, and large files like PDFs or archives are passed by path for the agent to read on demand. Attachments live in the app data directory and **never pollute your project**.

## Voice input

Click the microphone in the composer toolbar to enter voice mode. When you finish, the transcript is placed back in the composer so **you can edit before sending** — it is never sent directly.

On desktop, the speech recognition backend can be Groq (recommended, free tier available), OpenAI Whisper, or a local ASR service. Switch under **Settings → Tools → Speech recognition**.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘` / `Ctrl` + `Enter` | Send message |
| `Enter` | New line |
| `⌘B` | Toggle the sidebar |
| `⌘N` | New task |
| `Esc` | Close dialog / exit voice |

## Sharing

The share button in the top bar creates a link to a **read-only snapshot of the current branch**. Anyone with the link can view but not interact; later conversation does not change the snapshot.
