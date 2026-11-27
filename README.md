# Gena

[![License: Prosperity 3.0.0](https://img.shields.io/badge/license-Prosperity%203.0.0-blue.svg)](LICENSE)
[![Deploy](https://github.com/sergey-frolov-pets/gena/actions/workflows/deploy.yml/badge.svg)](https://github.com/sergey-frolov-pets/gena/actions/workflows/deploy.yml)
[![CI](https://github.com/sergey-frolov-pets/gena/actions/workflows/ci.yml/badge.svg)](https://github.com/sergey-frolov-pets/gena/actions/workflows/ci.yml)

**English** · [Русский](README.ru.md)

Serverless messenger SPA for AI agents. Built as a static site and deployed to GitHub Pages — no backend, all state lives in the browser.

**Live:** https://sergey-frolov-pets.github.io/gena/
**Discussions:** https://github.com/sergey-frolov-pets/gena/discussions

## Features

- **Connections** — your own agents and LLMs. Protocols: HTTP JSON (`POST` → `{reply}`), OpenAI-compatible chat (`/v1`), and Pico (WebSocket). Address, Bearer key, model, context size, optional system prompt, and a daily call limit.
- **Bring your own key** — Gena does not sell model access. The key stays encrypted on this device (device seed → HKDF-SHA256 → AES-GCM-256, envelope `enc:v1:`, bound to `agentId`). Backups never include keys.
- **Chat** — several dialogs at once, search, pin, rename, duplicate, delete. Attach images and text files. Dictate a message; after three seconds of silence it is sent unless you tap the input. Replies can be read aloud. Stop a running reply or queue the next one. Empty dialogs offer starter prompts.
- **Protected mode** — a token dictionary replaces sensitive values before they go to the agent. The selection panel appears only in this mode. The dictionary is a table; every form stays masked until you reveal the row. Deleting a token names it.
- **Quick phrases** — per agent, one phrase per line, shown as buttons in the chat.
- **Daily call limit** — per-agent counter in IndexedDB (`usage`, UTC day). Send is blocked when it is exhausted. The chat shows “N / M calls today”.
- **Readable errors** — 401/403/404/429/5xx, CORS, non-JSON, and private mode become a sentence instead of a status code.
- **9 UI languages** — English, Russian, Spanish, Chinese, Japanese, Hindi, Portuguese, German, Arabic (RTL). The choice is stored in `localStorage`. Light and dark theme. Install to the home screen.
- **History backup** — export and import JSON without keys. Import merges; existing agents keep their keys.
- **Cleanup** — delete every session, or everything except the ones you keep. Agents stay.

## Stack

Vue 3 + Vite + TypeScript, `idb` for IndexedDB, WebCrypto for encryption.

## Development

```bash
npm install
npm run dev        # dev server
npm run typecheck  # vue-tsc
npm test           # vitest (crypto, backup, cleanup, usage limits, errors, client, i18n)
npm run build      # production build into dist/
```

## Deploy to GitHub Pages

Workflow `.github/workflows/deploy.yml` builds and publishes `dist/` on push to `main`.
`base` in `vite.config.ts` is derived from `GITHUB_REPOSITORY` (or set `VITE_BASE`).
SPA routing: `dist/404.html` is copied from `index.html`.

## Data model (IndexedDB `gena`, v2)

| Store | Key | Contents |
|---|---|---|
| `agents` | `id` | name, address, sealed key, settings (contextSize, callLimit, llmModel) |
| `sessions` | `id` | agentId, title, messageCount, createdAt, updatedAt |
| `messages` | `id` | sessionId, role, content, createdAt |
| `usage` | `agentId` | date (UTC day), count |

## Internationalization

Translations live in `src/i18n/<locale>/` (one file per UI area: `app`, `chat`, `connections`, `sessions`, `errors`).
English (`src/i18n/en/`) is the source of truth: every other locale must cover all its keys.
`src/lib/errors.ts` returns keys, the UI translates them with the `t()` function from `useLocale()`.

## Agent contract

Request:

```json
{
  "message": "string",
  "sessionId": "string",
  "settings": { "contextSize": 20, "callLimit": 0, "llmModel": "gpt-4o-mini" },
  "history": [{ "role": "user", "content": "..." }]
}
```

Response:

```json
{ "reply": "string" }
```

The agent must allow CORS for the site origin.

## Gena server agents

A server (see `server/`) can hold provider keys itself. Then the browser
stores only the server token and the chat goes through
`POST /api/agents/{id}/chat`.

- `GET /api/agents` returns `[{ id, name, model, provider? }]` — never keys.
- Agents from a connected server show up in the chat agent picker with a
  "on server" tag and are read-only in Connections: they come from
  `/etc/gena-server/agents.json`, not from the device database.
- They are kept in memory only (`serverAgents` in `lib/store.ts`), so a
  backup or export never contains them.

## Security

- The agent key is stored **only encrypted**; it never appears in a backup.
- If `localStorage` is unavailable (private mode), the key is not saved (`missing_seed`) — so the secret is never written in plain text.
- AES-GCM provides integrity: tampering with the ciphertext or using a foreign `agentId` fails decryption.

## License

Prosperity Public License 3.0.0 — free for non-commercial use, commercial use has a 30-day trial. Full text in [LICENSE](LICENSE).
