# План: подключение LLM-моделей в Gena (BYOK)

Дата: 2026-11-20. Автор: PicoClaw. Источник кода: `code2graph` (MIT-часть проекта,
собственная разработка — переносим без лицензионных вопросов).

## 1. Что делаем

В Gena сейчас есть только «подключения к агентам» (`agents`: адрес + ключ + настройки).
Нужно добавить второй тип подключения — **LLM-модель**: пользователь задаёт имя,
провайдера, модель, ключ и параметры генерации, и может общаться с ней в том же чате.

Ключевое решение по реплике Сергея от 20.11.2026:

| № | Требование | Как реализуем |
|---|---|---|
| 1 | Шифровать как в code2graph | AES-GCM-256 + HKDF-SHA256 от device seed, конверт `enc:v1:<iv>.<cipher>`, `additionalData` = id записи. Ядро выносим в общий `secret-cipher.ts`, агентские конверты не ломаем |
| 2 | Gemini в первой итерации | Провайдер `google-gemini` через `generateContent` (`?key=`), как в `code2graph` |
| 3 | Как у агента: имя + провайдер + модель + настройки; имя по умолчанию — сокращённо провайдер (2–3 буквы) + модель | Форма в стиле `ConnectionsView`, автоподстановка имени `gem-gemini-2.0-flash` |
| 4 | Оставляем | Агенты, их `settings.llmModel`, сессии и история — без миграций и изменений поведения |

## 2. Архитектура: модель = агент с протоколом `llm`

Вместо отдельного стора и отдельного «целевого типа» сессии — **новый протокол у той же
сущности `Agent`**. Так чат, история, счётчики вызовов, бэкап и UI-список работают
без изменений: `ChatView` уже выбирает транспорт по `agent.protocol`.

```ts
// storage/types.ts
export type Protocol = "http_json" | "openai" | "pico_ws" | "llm";

export interface LlmPresetConfig {
  /** id провайдера из каталога: google-gemini, openrouter, groq, deepseek, ... */
  providerId: string;
  /** id модели у провайдера: gemini-2.0-flash, google/gemma-4-31b-it:free, ... */
  model: string;
  systemPrompt?: string;
  parameters?: LlmPresetParameters; // temperature, topP, maxTokens, jsonMode
}
export type AgentConfig = OpenAIConfig | PicoConfig | HttpJsonConfig | LlmPresetConfig;
```

`address` у такого агента — `apiEndpoint` провайдера (заполняется автоматически из каталога,
в форме скрыто, редактируется только при `providerId = "custom"`). `sealedKey` — тот же
зашифрованный ключ, что у агента. `settings.contextSize` / `callLimit` работают как есть.

Почему не отдельный стор `models`:
- `ChatView`, `SessionsView`, `usage` (лимит вызовов в сутки), `backup` уже завязаны на `agentId`;
  отдельная сущность потребует union-типа по всей цепочке (сессия → сообщение → счётчик → бэкап);
- риск регрессии в уже оттестированном чате выше, чем выгода от разделения доменов.

UI-разделение делаем на уровне вида: в `ConnectionsView` появляются две секции —
«Агенты» (`http_json` / `openai` / `pico_ws`) и «Модели» (`llm`), с разными формами.

## 3. Шифрование

Сейчас: `src/crypto/agent-key-cipher.ts` — уже нужная схема (device seed → HKDF → AES-GCM,
AAD = `agentId`). Менять соль/info агентов **нельзя** — существующие `enc:v1:` ключи перестанут
расшифровываться.

Шаги:

1. Вынести ядро в `src/crypto/secret-cipher.ts`:
   ```ts
   export interface CipherScope { salt: string; info: string; }
   export const AGENT_SCOPE: CipherScope = { salt: "gena.agent-key.v1", info: "gena-agent-api-key" };
   export const MODEL_SCOPE: CipherScope = { salt: "gena.model-key.v1", info: "gena-model-api-key" };
   export function sealSecret(plain: string, id: string, scope: CipherScope): Promise<string>;
   export function openSecret(stored: string, id: string, scope: CipherScope): Promise<string>;
   export function isSealedSecret(value: string): boolean; // префикс enc:v1:
   ```
   Кэш производного ключа — `Map<salt, {seed, key}>`, чтобы агентский и модельный ключи
   не вытесняли друг друга.
2. `agent-key-cipher.ts` оставить как тонкую обёртку над `AGENT_SCOPE` (экспортируемые
   имена не меняем — `store.ts`, тесты и бэкап продолжают работать).
3. `src/crypto/model-key-cipher.ts` — обёртка над `MODEL_SCOPE`:
   `sealModelKey/openModelKey/isSealedModelKey`, ошибки — те же коды
   `missing_seed` / `decrypt_failed` (их уже умеет переводить `lib/errors.ts`).
4. Конверт оставляем `enc:v1:` для обоих (совместимо с code2graph); разную соль/info
   достаточно, чтобы модель-ключ не расшифровался как агентский и наоборот.
5. В бэкап ключи не попадают — `storage/backup.ts` уже вырезает `sealedKey`; добавить тест
   на `protocol: "llm"` с ключом.

## 4. Каталог провайдеров и моделей (перенос из code2graph)

`src/constants/llm-providers.ts` (адаптация `code2graph/src/constants/llm-providers.ts`):

| id | имя | endpoint | ключ | итерация |
|---|---|---|---|---|
| `google-gemini` | Google Gemini | `generateContent` | да | 1 |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | да | 1 |
| `groq` | Groq | `https://api.groq.com/openai/v1` | да | 1 |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | да | 1 |
| `moonshot` | Moonshot | `https://api.moonshot.ai/v1` | да | 1 |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | да | 1 |
| `qwen` | Qwen (DashScope) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | да | 1 |
| `zhipu` | Zhipu | `https://open.bigmodel.cn/api/paas/v4` | да | 1 |
| `custom` | Свой OpenAI-совместимый | вводится руками | опционально | 1 |

Поля провайдера: `id`, `label`, `short` (2–3 буквы для имени по умолчанию: `gem`, `or`,
`groq`, `ds`, `moon`, `mis`, `qw`, `zp`, `cus`), `apiEndpoint?`, `kind: "gemini" | "openai"`,
`defaultModel`, `keyUrl`, `docsUrl`.

Список моделей: `src/lib/model-catalog.ts`
- Gemini: `GET https://generativelanguage.googleapis.com/v1beta/models?key=<key>` → `models[].name`, отфильтровать `supportedGenerationMethods.includes("generateContent")`, срезать `models/`;
- OpenAI-совместимые: `GET {base}/models` с `Authorization: Bearer`;
- ключа нет / сеть упала / CORS → возвращаем `defaultModel` провайдера и не блокируем форму
  (ошибка каталога — не ошибка сохранения);
- таймаут 8 с, результат в памяти сессии (без персиста).

## 5. Клиент запросов

`src/lib/llm-client.ts` (упрощённый `code2graph/services/llm/providers/byok-providers.ts`):

```ts
export interface LlmCallInput {
  preset: LlmPresetConfig; apiKey: string;
  messages: LlmChatMessage[]; // system/user/assistant
  temperature?: number; topP?: number; maxTokens?: number; jsonMode?: boolean;
  signal?: AbortSignal;
}
export async function callLlm(input: LlmCallInput): Promise<{ text: string; usage?: unknown }>;
```

- `google-gemini` → `POST {gemini}/v1beta/models/{model}:generateContent?key=…`,
  `systemInstruction` + `contents` (`role: user|model`), `generationConfig`
  (`temperature`, `topP`, `maxOutputTokens`, `responseMimeType` при `jsonMode`);
- остальные → `POST {base}/chat/completions`, `messages`, `temperature`, `top_p`, `max_tokens`;
- ошибки → `AgentClientError` с кодами `http_status`, `empty_response`, `network`
  (уже локализуются в `lib/errors.ts`); `AbortError` пробрасываем как есть;
- стриминг в 1-й итерации не делаем (Chunked SSE — этап 2, вместе с «печатает…» по токенам).

Транспорт для чата: `src/lib/transports/llm-preset.ts`, реализует существующий интерфейс
`Transport` (`send(...) → { reply, attachments? }`). Регистрируется в
`transports/index.ts` по `protocol === "llm"`; историю режем тем же `trimHistory`.

Проверка подключения: в `lib/connection-check.ts` ветка `llm` — один запрос
`"ping"`, `maxTokens: 1` (Gemini — `maxOutputTokens: 1`) и проверка непустого ответа.

## 6. UI

`ConnectionsView.vue` → две секции с переключателем (`Агенты` / `Модели`), форма модели:

| Поле | Поведение |
|---|---|
| Имя | свободный ввод; если пусто при сохранении — `{short}-{model}` (`gem-gemini-2.0-flash`), при занятом имени — суффикс `-2` |
| Провайдер | `select` из каталога |
| Модель | `input` + `datalist` из каталога (если ключ введён), плейсхолдер = `defaultModel` |
| Ключ | `password`, при редактировании — только замена («ключ сохранён») |
| Системный промпт | необязательный `textarea` |
| temperature / topP / maxTokens | числа с валидацией: 0–2, 0–1, 1–32768; пусто = дефолт провайдера |
| jsonMode | чекбокс, по умолчанию выкл (для чата Gena не нужен) |
| contextSize / callLimit | как у агента |

В карточке модели: имя, бейдж провайдера, модель, кнопки «Изменить / Проверить / Удалить»,
строка «ключ сохранён / ключ не задан». Удаление — через `ConfirmModal` (как у агентов).

Роутинг/навигация: отдельный маршрут не нужен, секция внутри «Подключений»; в `ChatView`
модель появляется в списке выбора цели вместе с агентами (тот же `agents` массив,
бейдж протокола уже показывается).

i18n: 9 локалей × ~28 новых ключей (`connections.tab.*`, `connections.model.*`,
`connections.field.provider`, `connections.field.temperature`, `connections.hint.*`,
`connections.error.*`). Русский и английский — вручную, остальные — по существующему
шаблону `i18n/*/connections.ts`.

## 7. Порядок работ

| # | Шаг | Готово, когда |
|---|---|---|
| 1 | `crypto/secret-cipher.ts` + обёртки `agent-key-cipher`, `model-key-cipher` | тесты: round-trip обоих scope, агентский конверт из main расшифровывается, кросс-scope даёт `decrypt_failed` |
| 2 | `constants/llm-providers.ts` | тест: у каждого провайдера есть `short` 2–3 символа, `defaultModel`, `kind` |
| 3 | `storage/types.ts`: `Protocol += "llm"`, `LlmPresetConfig`, нормализация `normalizeAgent` | старые агенты читаются как раньше, `llm` не ломает `http_json` |
| 4 | `lib/llm-client.ts` (gemini + openai-compatible) | тесты с мок-`fetch`: тело запроса, парсинг ответа, коды ошибок |
| 5 | `lib/model-catalog.ts` | тест: нет ключа → дефолтная модель; 401 → дефолтная модель + флаг ошибки; Gemini-парсинг `models/*` |
| 6 | `lib/transports/llm-preset.ts` + регистрация | тест: `send()` возвращает `reply`, история обрезается по `contextSize` |
| 7 | `lib/connection-check.ts`: ветка `llm` | тест: ok / http 401 / пустой ответ |
| 8 | `lib/store.ts`: `createAgent`/`updateAgent` поддерживают `llm` (ключ через `sealModelKey`) | тест: ключ запечатан, `getAgentKey` возвращает открытый |
| 9 | `ConnectionsView.vue`: секции + форма модели + автоподстановка имени | typecheck, ручная проверка в браузере |
| 10 | i18n (9 локалей) | `i18n.test.ts` зелёный, нет «сырых» ключей |
| 11 | Бэкап: тест «ключ модели не попадает в экспорт» | тест зелёный, `BACKUP_VERSION` не меняем |
| 12 | Прогон: `npm run typecheck && npm test && npm run build`, `check_code.py` | всё зелёное |

Оценка: ~14 файлов (4 новых модуля, 1 новый транспорт, 1 новый вид-секция, правки в 6 файлах,
тесты), 400–600 строк прод-кода.

## 8. Риски и как снимаем

| Риск | Что делаем |
|---|---|
| CORS у части провайдеров (Groq, Qwen, Zhipu) | проверяем `Проверить подключение`; при `TypeError` показываем «провайдер не разрешает запросы из браузера», а не «неверный ключ». Прокси, как в code2graph, — этап 3 |
| Утечка ключа в бэкап/логи | ключ только в `sealedKey`, в `console`/ошибки не пишем; тест на бэкап |
| Сломать агентские ключи при рефакторинге шифра | `AGENT_SCOPE` фиксирован, есть тест на конверт, созданный до правок |
| Gemini отдаёт несколько `parts` | склеиваем `parts.map(p => p.text).join("")` |
| Ошибка «модель не найдена» | каталог подставляет `defaultModel`, поле свободное — можно вписать вручную |

## 9. Что НЕ делаем в этой итерации

- стриминг ответа и «печатает…» по токенам (сейчас — как у `openai`-агента: ответ целиком);
- прокси для CORS-закрытых провайдеров;
- автоматическую подстановку «модель по умолчанию» в существующие агенты;
- изменение ключей агентов и их `settings.llmModel` (п. 4 реплики — «оставляем»).

## 10. Проверка перед сдачей

```bash
cd /root/.picoclaw/workspace/gena
npm run typecheck && npm test && npm run build
python3 ../skills/code-review-hook/scripts/check_code.py src/crypto/*.ts src/lib/model-catalog.ts \
  src/lib/llm-client.ts src/lib/transports/llm-preset.ts src/views/ConnectionsView.vue
```

Ручной чек-лист: добавить Gemini с ключом → «Проверить» зелёный → отправить «привет» в чате →
ответ в истории; добавить OpenRouter без ключа → ошибка понятная, форма не падает;
перезагрузить страницу → ключ на месте (расшифровывается), имя модели в списке.
