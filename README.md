# Gena

[![License: Prosperity 3.0.0](https://img.shields.io/badge/license-Prosperity%203.0.0-blue.svg)](LICENSE)
[![Deploy](https://github.com/sergey-frolov-pets/gena/actions/workflows/deploy.yml/badge.svg)](https://github.com/sergey-frolov-pets/gena/actions/workflows/deploy.yml)
[![CI](https://github.com/sergey-frolov-pets/gena/actions/workflows/ci.yml/badge.svg)](https://github.com/sergey-frolov-pets/gena/actions/workflows/ci.yml)

**English** · [Русский](README.ru.md)

Serverless messenger SPA for AI agents. Built as a static site and deployed to GitHub Pages — no backend, all state lives in the browser.

**Live:** https://sergey-frolov-pets.github.io/gena/

## Features

- **Agent connections** — address (URL endpoint), key (Bearer), settings (context size, daily call limit, LLM model).
- **Daily call limit** — per-agent counter in IndexedDB (`usage` store, UTC day), send is blocked when exhausted, "N / M calls today" indicator.
- **Readable errors** — 401/403/404/429/5xx, CORS/network, non-JSON, private mode → human text instead of a raw status code.
- **9 UI languages** — English, Russian, Spanish, Chinese, Japanese, Hindi, Portuguese, German, Arabic (RTL). English is the default; the choice is persisted in `localStorage`.
- **Chat** — sends `POST {message, sessionId, settings, history}` → `{reply}`, history stored in IndexedDB.
- **Key encryption** — device seed in `localStorage` → HKDF-SHA256 → AES-GCM-256. Envelope `enc:v1:<iv>.<cipher>`, bound to `agentId` via `additionalData`. Rebuilding the app does not break keys.
- **History backup** — export/import plain JSON **without agent keys** (sessions, messages, agent settings only). Import merges: existing agents keep their keys, conflicts are skipped.
- **IndexedDB cleanup** — "delete all except selected" + "delete all". Agents are preserved.

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

## Security

- The agent key is stored **only encrypted**; it never appears in a backup.
- If `localStorage` is unavailable (private mode), the key is not saved (`missing_seed`) — so the secret is never written in plain text.
- AES-GCM provides integrity: tampering with the ciphertext or using a foreign `agentId` fails decryption.

## License

Prosperity Public License 3.0.0 — free for non-commercial use, commercial use has a 30-day trial. Full text in [LICENSE](LICENSE).
