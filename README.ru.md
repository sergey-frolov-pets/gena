# Gena

[![License: Prosperity 3.0.0](https://img.shields.io/badge/license-Prosperity%203.0.0-blue.svg)](LICENSE)
[![Deploy](https://github.com/sergey-frolov-pets/gena/actions/workflows/deploy.yml/badge.svg)](https://github.com/sergey-frolov-pets/gena/actions/workflows/deploy.yml)
[![CI](https://github.com/sergey-frolov-pets/gena/actions/workflows/ci.yml/badge.svg)](https://github.com/sergey-frolov-pets/gena/actions/workflows/ci.yml)

[English](README.md) · **Русский**

Serverless-мессенджер для ИИ-агентов. Собирается статикой и деплоится на GitHub Pages — без бэкенда, всё состояние в браузере.

**Живая версия:** https://sergey-frolov-pets.github.io/gena/

## Что умеет

- **Подключения к агентам** — адрес (URL endpoint), ключ (Bearer), настройки (размер контекста, лимит вызовов в сутки, LLM-модель).
- **Дневной лимит вызовов** — счётчик на агента в IndexedDB (стор `usage`, UTC-день), блокировка отправки при исчерпании, индикатор «N / M вызовов сегодня».
- **Понятные ошибки** — 401/403/404/429/5xx, CORS/сеть, не-JSON, приватный режим → человекочитаемый текст вместо сырого статуса.
- **9 языков интерфейса** — английский, русский, испанский, китайский, японский, хинди, португальский, немецкий, арабский (RTL). По умолчанию английский; выбор запоминается в `localStorage`.
- **Чат** — отправка `POST {message, sessionId, settings, history}` → `{reply}`, история в IndexedDB.
- **Шифрование ключей** — device seed в `localStorage` → HKDF-SHA256 → AES-GCM-256. Конверт `enc:v1:<iv>.<cipher>`, привязка к `agentId` через `additionalData`. Смена версии сборки ключи не ломает.
- **Бэкап истории** — экспорт/импорт открытого JSON **без ключей агентов** (только сессии, сообщения, настройки агента). Импорт со слиянием: ключи существующих агентов сохраняются, конфликты пропускаются.
- **Очистка IndexedDB** — «удалить всё, кроме отмеченных» + «удалить все». Агенты при очистке сохраняются.

## Стек

Vue 3 + Vite + TypeScript, `idb` для IndexedDB, WebCrypto для шифрования.

## Разработка

```bash
npm install
npm run dev        # dev-сервер
npm run typecheck  # vue-tsc
npm test           # vitest (крипто, бэкап, очистка, лимиты, ошибки, клиент, i18n)
npm run build      # production-сборка в dist/
```

## Деплой на GitHub Pages

Workflow `.github/workflows/deploy.yml` собирает и публикует `dist/` при пуше в `main`.
`base` в `vite.config.ts` вычисляется из `GITHUB_REPOSITORY` (или задайте `VITE_BASE`).
SPA-роутинг: `dist/404.html` копируется из `index.html`.

## Модель данных (IndexedDB `gena`, v2)

| Стор | Ключ | Содержимое |
|---|---|---|
| `agents` | `id` | имя, адрес, зашифрованный ключ, настройки (contextSize, callLimit, llmModel) |
| `sessions` | `id` | agentId, заголовок, messageCount, createdAt, updatedAt |
| `messages` | `id` | sessionId, role, content, createdAt |
| `usage` | `agentId` | дата (UTC-день), счётчик вызовов |

## Локализация

Переводы лежат в `src/i18n/<locale>/` (по файлу на область интерфейса: `app`, `chat`, `connections`, `sessions`, `errors`).
Английский (`src/i18n/en/`) — источник истины: остальные языки обязаны покрывать все его ключи.
`src/lib/errors.ts` возвращает ключи, UI переводит их функцией `t()` из `useLocale()`.

## Контракт агента

Запрос:

```json
{
  "message": "string",
  "sessionId": "string",
  "settings": { "contextSize": 20, "callLimit": 0, "llmModel": "gpt-4o-mini" },
  "history": [{ "role": "user", "content": "..." }]
}
```

Ответ:

```json
{ "reply": "string" }
```

Агент должен разрешать CORS для origin сайта.

## Безопасность

- Ключ агента хранится **только зашифрованным**; в бэкап не попадает ни в каком виде.
- Если `localStorage` недоступен (приватный режим), ключ не сохраняется (ошибка `missing_seed`) — чтобы не писать секрет в открытом виде.
- AES-GCM даёт целостность: подмена шифротекста или чужой `agentId` → ошибка расшифровки.

## Лицензия

[The Prosperity Public License 3.0.0](LICENSE) — бесплатно для некоммерческого использования, коммерческое — 30-дневный пробный период. Полный текст в файле `LICENSE`.
