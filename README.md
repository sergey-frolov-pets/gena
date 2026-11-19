# Gena

Serverless messenger SPA. Собирается статикой и деплоится на GitHub Pages — без бэкенда, всё состояние в браузере.

## Что умеет

- **Подключения к агентам** — адрес (URL endpoint), ключ (Bearer), настройки (размер контекста, лимит вызовов в сутки, LLM-модель).
- **Чат** — отправка `POST {message, sessionId, settings, history}` → `{reply}`, история в IndexedDB.
- **Шифрование ключей** — device seed в localStorage → HKDF-SHA256 → AES-GCM-256. Конверт `enc:v1:<iv>.<cipher>`, привязка к `agentId` через `additionalData`. Смена версии сборки ключи не ломает.
- **Бэкап истории** — экспорт/импорт открытого JSON **без ключей агентов** (только сессии, сообщения, настройки агента).
- **Очистка IndexedDB** — «удалить всё, кроме отмеченных» + «удалить все». Агенты при очистке сохраняются.

## Стек

Vue 3 + Vite + TypeScript, `idb` для IndexedDB, WebCrypto для шифрования.

## Разработка

```bash
npm install
npm run dev        # dev-сервер
npm run typecheck  # vue-tsc
npm test           # vitest (крипто, бэкап, очистка)
npm run build      # production-сборка в dist/
```

## Деплой на GitHub Pages

Workflow `.github/workflows/deploy.yml` собирает и публикует `dist/` при пуше в `main`.
`base` в `vite.config.ts` вычисляется из `GITHUB_REPOSITORY` (или задайте `VITE_BASE`).
SPA-роутинг: `dist/404.html` копируется из `index.html`.

## Модель данных (IndexedDB `gena`, v1)

- `agents` — `{id, name, address, sealedKey, settings, createdAt, updatedAt}`
- `sessions` — `{id, agentId, title, createdAt, updatedAt, messageCount}` (индексы `by-agent`, `by-updated`)
- `messages` — `{id, sessionId, role, content, createdAt}` (индексы `by-session`, `by-session-created`)

## Безопасность

- Ключ агента хранится **только зашифрованным**; в бэкап не попадает ни в каком виде.
- Если localStorage недоступен (приватный режим), ключ не сохраняется (ошибка `missing_seed`) — чтобы не писать секрет в открытом виде.
- AES-GCM даёт целостность: подмена шифротекста или чужой `agentId` → ошибка расшифровки.
