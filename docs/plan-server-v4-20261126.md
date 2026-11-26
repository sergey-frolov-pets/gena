# Gena Server v4 — SQLite+SQLCipher, приглашения, общие сессии, проекты

План от 26.11.2026. Заменяет `plan-server-v2-20261126.md` (bbolt) и `plan-server-v3-20261126.md`.
Релиз после работ: **0.3.0**.

## 1. Требования (согласованы с Сергеем)

1. Поиск по сообщениям нужен → **SQL**, а не key-value.
2. Добавление клиента: **код**, **QR** или **код+QR** — на выбор.
3. Отдельный код, если на сервере есть **агент** — чтобы добавить агента в клиент с быстрыми вставками.
4. **Анонимайзер** — «Справочник подстановок» (маскировка реальных значений токенами перед отправкой
   во внешнюю LLM). В приглашении — отдельной галочкой.
5. Код может нести **все три опции, две или одну** (соединение, агент, анонимайзер).
6. **Ключ провайдера кладём в приглашение**, но он шифруется и работает **только для клиентов,
   добавленных по этому коду**.
7. В коде — **срок действия** и **сколько устройств** можно подключить (устройство = один пользователь).
   Срок действует **и на приглашение, и на доступ**: после истечения сервер клиента не обслуживает.
8. Админ сбрасывает токен клиента вручную; клиент удаляет подключение вручную.
9. Сессия помечается **общей** — открывается любым устройством сервера; иначе только владельцем.
   Плюс **локальные** сессии как раньше.
10. **Проект** — папка для сессий одной тематики, есть **и на сервере, и локально**.

## 2. База: SQLite + SQLCipher (проверено сборкой)

| Вариант | Шифрование | FTS5 | Чистый Go | Размер | Итог |
|---|---|---|---|---|---|
| **A. SQLCipher** (`mutecomm/go-sqlcipher/v4`, cgo) | страницы целиком | да (тег `sqlite_fts5`) | нет | 7,3 МБ | **выбран** |
| B. `modernc.org/sqlite` (чистый Go) | только колонки | да, но индекс открытым текстом | да | 10,0 МБ | аварийный запас |

Факты спайка (`tmp/spike_sql.sh`, `tmp/spike_sqlcipher.sh`, 26.11): сборка cgo ~4 мин, `PRAGMA key`
работает, FTS5 `MATCH` → 1 совпадение, `grep` по файлу БД → **0**. Без тега `sqlite_fts5` модуль
поиска молча отсутствует (`no such module: fts5`) — тег прописываем в Makefile, CI и install-скрипт.

gcc нужен **только при сборке** (на VPS есть). Пользователю уходит готовый бинарник amd64/arm64;
статическая линковка — проверю в этапе 8, при проблемах оставляем динамическую (обычный Linux).

## 3. Схема БД

Структура повторяет IndexedDB (имена полей в `json` — как в браузере), поэтому клиентские типы и
`api.go` не переписываются: меняется реализация `Store`.

```sql
meta(key TEXT PK, value TEXT)                  -- schema=4, serverId, createdAt

agents   (id TEXT PK, json TEXT, updated_at INTEGER)
sessions (id TEXT PK, json TEXT, title_enc BLOB,
          project_id TEXT NULL, owner_device TEXT, shared INTEGER DEFAULT 0,
          created_at INTEGER, updated_at INTEGER)
messages (id TEXT PK, session_id TEXT, seq INTEGER, json TEXT,
          role TEXT, created_at INTEGER, body_enc BLOB)      -- body_enc нужен только для варианта B
projects (id TEXT PK, json TEXT, name_enc BLOB,
          owner_device TEXT, shared INTEGER DEFAULT 0, order_index INTEGER,
          created_at INTEGER, updated_at INTEGER)
usage(agent_id PK, json), queue(id PK, json), tokens(id PK, json),
morph(id PK, json), audit(id PK, json), servers(id PK, json)

devices  (id TEXT PK, label TEXT, invite_id TEXT, created_at INTEGER, last_seen INTEGER,
          expires_at INTEGER NULL,                 -- = срок доступа (из приглашения)
          revoked INTEGER DEFAULT 0, key_hash BLOB)
invites  (id TEXT PK, options TEXT, payload_enc BLOB,
          secret_enc BLOB,                         -- секрет приглашения (для wrap ключа агента)
          expires_at INTEGER, max_devices INTEGER, used INTEGER DEFAULT 0,
          created_at INTEGER, revoked INTEGER DEFAULT 0)
invite_uses(invite_id TEXT, device_id TEXT, at INTEGER)

-- справочник подстановок (анонимайзер), общий для устройств одного приглашения
dicts(id TEXT PK, name TEXT, version INTEGER, entries_enc BLOB,
      invite_id TEXT NULL, owner_device TEXT, updated_at INTEGER)
agent_keys(agent_id TEXT PK, invite_id TEXT,
           key_enc_db BLOB,                        -- зашифрован ключом БД (режим прокси)
           created_at INTEGER)

CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at DESC);
CREATE INDEX idx_sessions_scope   ON sessions(shared, owner_device);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_projects_order   ON projects(order_index, updated_at DESC);
CREATE VIRTUAL TABLE fts_message USING fts5(id UNINDEXED, session_id UNINDEXED, body,
                                            tokenize='unicode61 remove_diacritics 2');
```

Миграция: `meta.schema` пусто + есть `data/sessions/*.json` → импорт, каталог в
`sessions.migrated-<дата>`, всем сессиям `project_id = NULL`.

## 4. Шифрование на диске

- Ключ страниц — `data/keys/db.key` (32 байта, 0600), `PRAGMA key`, `PRAGMA cipher_memory_security=ON`.
  Переопределение — `GENA_DB_KEY_FILE`. **Потеря ключа = потеря данных**: бэкап `gena.db` + `db.key`
  вместе, предупреждение в README / `AGENT_INSTALL.md` / выводе `gena-server init`.
- `gena-server backup <файл>` → `VACUUM INTO` (копия тоже зашифрована), `compact` → `VACUUM` по таймеру.

## 5. Транспорт: шифрованный конверт поверх HTTP

TLS на домашнем сервере часто нет — шифруем сами.

- PSK (32 байта) выдаётся в приглашении; HKDF(`serverId`) → `c2s`, `s2c`; на устройство — свой ключ
  (PSK + deviceID), поэтому отзыв одного не рвёт остальные.
- Запрос: `X-Gena-Dev`, `-TS`, `-Nonce`; тело AES-256-GCM, AAD = `method|path|ts|nonce|deviceID`;
  тег GCM = аутентификация устройства, Bearer-токен не нужен. Ответ — в ключе `s2c`.
- Replay: окно ±120 с, nonce в LRU на 5 минут. `GET /api/health` открыт:
  `{serverId, version, enc:"v1", features:[...]}`.
- `GET /api/whoami` → `{deviceId, inviteId, expiresAt, projectScope}` — клиент показывает «доступ до …».

## 6. Приглашения

```bash
gena-server invite --label laptop --ttl 30d --devices 3 \
  --with conn --with agent --with anon \
  --delivery both                    # code | qr | both
```

| Опция | Что кладём | Флаги |
|---|---|---|
| `conn` | URL сервера, `serverId`, PSK | обязательна, если клиент ещё не подключён |
| `agent` | протокол, baseUrl, модель, параметры, **ключ провайдера** | `--include-agent-key` (по умолчанию **включён**), `--agent-key-mode proxy\|device` |
| `anon` | включить маскировку + ссылка на справочник подстановок | `--dict <id>`, `--dict-inline` |

- Любая комбинация: все три, две или одна. `agent`/`anon` без `conn` применяются к текущему серверу.
- **TTL** (`--ttl`, по умолчанию 15 мин, максимум 90 дней) действует дважды: приглашение нельзя
  использовать после `expires_at` (`410 invite_expired`), и **выданные по нему устройства получают
  `devices.expires_at = invites.expires_at`** → дальше `403 {"error":"access_expired"}`.
  Продление — `gena-server device extend <id> --days N` (или новый инвайт для переподключения).
- **`--devices N`** — счётчик `used`, каждое устройство = один пользователь; исчерпано →
  `403 invite_exhausted`, приглашение закрывается само. `--single` — одноразовое.
- Код: `gena1:<base64url(JSON)>`, JSON `{v:1,u,sid,k,e,lbl,opts:{conn,agent,anon},max}`.
  QR — тот же текст: PNG (`invite-<id>.png`), терминал, страница `/pair` (под админ-токеном).
- Отзыв: `invite revoke <id>`, `device revoke <id>` (сброс токена клиента). На клиенте подключение
  удаляется вручную, с опцией «сообщить серверу» (`DELETE /api/devices/self`).

### 6.1 Ключ провайдера: два режима, оба «только для этого кода»

- **proxy** (по умолчанию): ключ не покидает сервер. Клиент зовёт `/api/proxy/{agentId}`,
  сервер подставляет ключ и проксирует запрос. Доступ — только устройствам приглашения
  (`agent_keys.invite_id` + проверка `devices.invite_id`), остальные получают `403`.
- **device**: на паре сервер отдаёт ключ, завёрнутый `HKDF(invite.secret, "agent-key")` →
  расшифровать может только устройство, добавленное по этому коду. В БД лежит лишь `key_enc_db`
  (ключ БД) — открытый ключ не пишется ни в базу, ни в логи, ни в ответы API.
- Ротация: `gena-server agent key rotate <agentId>` — перевыпускает и раздаёт заново.

### 6.2 Анонимайзер = справочник подстановок

- В клиенте уже есть `tokens` (словарь «реальное значение ↔ токен») и `morph` (морфология для падежей).
  Задача сервера — **общий словарь**, чтобы одно и то же значение на всех устройствах превращалось
  в один и тот же токен (иначе сообщение, замаскированное на ноутбуке, не восстановить на телефоне).
- `dicts` хранится зашифрованным (`entries_enc`), привязан к `invite_id`; `GET /api/dict/{id}`
  отдаёт только устройствам этого приглашения, версия (`version`) — для инкрементальной синхронизации.
- Приглашение с `--with anon`: клиент включает маскировку для добавленного подключения и подтягивает
  словарь (`--dict-inline` — словарь прямо в коде, для офлайн-установки; иначе по `dictId` после пары).
- Сам конвейер маскировки остаётся клиентским (он уже работает), сервер только хранит словарь и
  раздаёт его по доступу.

## 7. Устройства и доступ

- `device list` (id, метка, приглашение, срок, последний раз, статус), `device revoke <id>`,
  `device extend <id> --days N`, `invite revoke <id>`.
- Клиент при `401 revoked` / `403 access_expired` показывает «доступ истёк» и предлагает переподключиться.
- `/pair`: активные приглашения (TTL, used/max), устройства, сроки, кнопки «сбросить» и «отозвать».

## 8. Проекты (папки для сессий)

**Модель.** `project` — папка, группирующая сессии по теме; существует локально и на сервере.
Поля: `id, name, color?, order, serverId?, ownerDevice?, shared, createdAt, updatedAt`.
Связь: `sessions.project_id` (NULL = «без проекта»).

**Локально (клиент).** IndexedDB **v9**: новый стор `projects` (`keyPath id`, индексы `by-order`,
`by-updated`). Миграция без потери данных: у существующих сессий `projectId = null`, они попадают
в группу «Без проекта».

**На сервере.** Таблица `projects`; видимость как у сессий: `shared = 1` → видят все устройства,
иначе только `owner_device`. Доступ к самой сессии по-прежнему определяется её собственным флагом —
перемещение в общую папку **не** делает личную сессию общей (в UI подсказка «сессия личная»).

**API.**
```
GET    /api/projects?scope=mine|shared|all
POST   /api/projects                {name, shared, order}
PATCH  /api/projects/{id}           {name?, shared?, order?}
DELETE /api/projects/{id}           # сессии не удаляются, project_id → NULL
POST   /api/sessions/{id}/project   {projectId | null}
GET    /api/sessions?scope=&project=
GET    /api/search?...&project=
```

**Клиент UI.** Секция «Проекты» в списке чатов: сворачиваемые группы, «Без проекта» внизу,
счётчик сессий, кнопка «＋ проект»; в меню сессии — «Переместить в проект»; бейдж «Общий» у папки;
фильтр по проекту в поиске; переименование/удаление проекта с подтверждением; drag-and-drop — позже.

**Синхронизация.** Как у сессий: по `id`, побеждает больший `updatedAt`; удаление — tombstone
`{id, deleted:true}` на 30 дней, чтобы папка не «воскресала» с другого устройства.

## 9. Этапы и время

| # | Работа | Файлы | Часы |
|---|---|---|---|
| 0 | Спайк A/B, фиксация выбора | `tmp/spike_sql*.sh` | **0,5 — сделано** |
| 1 | `Store` на SQLite + миграция JSON + тест FTS5-доступности | `server/store_sql.go`, `migrate.go`, `crypto.go` | 5 |
| 2 | Устройства + приглашения (опции, TTL, лимит, срок доступа) + конверт | `server/devices.go`, `invites.go`, `envelope.go` | 5 |
| 3 | Ключ агента: proxy-режим, wrap по приглашению, ротация | `server/agentkeys.go`, `proxy.go` | 2,5 |
| 4 | Анонимайзер: словарь на сервере, выдача по приглашению, версии | `server/dicts.go` | 2 |
| 5 | Проекты на сервере: таблица, CRUD, `project_id` у сессий, scope | `server/projects.go`, `api.go` | 2 |
| 6 | Общие сессии (`shared`, scope, `PATCH`) + поиск по FTS5 | `server/sessions.go`, `search.go` | 3 |
| 7 | CLI: `init/invite/device/backup/compact`, QR (терминал + PNG), `/pair` | `server/cli.go`, `qr.go`, `pair.go` | 3 |
| 8 | Сборка: cgo/static, Dockerfile, `install.sh`, Makefile с `-tags sqlite_fts5` | `server/Dockerfile`, `install.sh` | 2 |
| 9 | Клиент: код/QR/камера, быстрые вставки агента, галочка анонимайзера, проекты (стор v9 + UI), бейдж «Общая», удаление подключения, поиск, i18n ×9 | `src/lib/gena-invite.ts`, `gena-server.ts`, `ConnectionsView.vue`, `ProjectsSection.vue`, `ChatView.vue`, `storage/*` | 6 |
| 10 | Документация, живой прогон, релиз 0.3.0 | `server/README.md`, `AGENT_INSTALL.md` | 2,5 |

**Итого ≈ 33,5 часа** → 4–5 сессий. Каждый этап закрывается зелёными `go test ./...`
(этап 9 — ещё `npm test` + `vue-tsc`).

Зависимости Go: `mutecomm/go-sqlcipher/v4`, `mdp/qrterminal/v3`, `golang.org/x/image` (PNG для QR).
AES-GCM/HKDF — stdlib. `go 1.24` в `go.mod`.

## 9.1 Порядок выката

1. Этапы 1–2 → сервер работает, старые данные мигрированы, приглашение по коду (без агента).
2. Этапы 3–6 → агент+ключ, словарь, проекты, общие сессии, поиск.
3. Этапы 7–8 → CLI/QR/`/pair`, сборка.
4. Этап 9 → клиент; 10 → релиз.

## 10. Критерии готовности

1. `data/gena.db` — единственный файл данных, `grep` не находит текста сообщений.
2. Старые JSON мигрируют, старые диалоги открываются, лишних папок не остаётся.
3. Приглашение выдаётся кодом, QR и обоими способами; все комбинации conn/agent/anon работают.
4. Ключ агента: запрос через прокси от устройства «чужого» приглашения → `403`; в `gena.db`
   и логах ключа нет.
5. `--devices 2` + третий клиент → `403`; после TTL → `410` для приглашения и `403 access_expired`
   для устройства; `device extend` возвращает доступ.
6. Админ сбрасывает токен → устройство теряет доступ; удаление подключения на клиенте работает.
7. Общая сессия видна и открывается с другого устройства, личная — нет.
8. Проект: создать локально и на сервере, переместить сессию, удалить папку (сессии целы),
   общая папка видна другому устройству, личная — нет.
9. Поиск: `q` находит сообщение в общей сессии другого устройства, в личной — не находит;
   фильтр по проекту работает.
10. `go test ./...` зелёный, `npm test` (748+) зелёный, `vite build` и `vue-tsc` чистые.

## 11. Риски

- **cgo на машине сборки** — проверено, 4 мин, 7,3 МБ; для чужих машин собираем в Docker.
- **FTS5 включается тегом** — тест, падающий при `no such module: fts5`, в CI и `install.sh`.
- **Потеря `db.key`** — данные нечитаемы; бэкап пары файлов + три предупреждения.
- **Словарь подстановок — самые чувствительные данные** (имена, суммы). В БД только шифрованным,
  выдача — по `invite_id`, в логи не попадает, в клиенте лежит в IndexedDB как сейчас.
- **Ключ агента в приглашении** — компромисс: код в мессенджере = ключ у получателя. Поэтому
  по умолчанию режим `proxy` (ключ вообще не уезжает), `device` — осознанный выбор админа.
- **Срок доступа = срок приглашения** — устройства «умирают» вместе с приглашением; чтобы продлить,
  есть `device extend`; в UI показываем дату.
- **Проекты и синхронизация** — tombstone'ы и разрешение конфликтов по `updatedAt`; покрыть тестами
  на «удалил на телефоне, открыл на ноутбуке».

## 12. Открытые вопросы (2)

1. **Словарь подстановок**: держим один общий на сервере (все устройства из приглашения работают
   одной таблицей токенов) — так и планирую. Или у каждого устройства свой словарь?
2. **Перемещение в общую папку**: сессия остаётся личной (моё решение по умолчанию) или при
   перемещении спрашиваем «сделать сессию общей?».

## 13. Модель

Реализация — **`ds-pro`** (DeepSeek V4-Pro, thinking, окно 1M): многофайлово, крипто-слой, cgo.
Независимое ревью крипто-слоя и прав доступа (ключ агента, словарь, общие сессии) — `or-sonnet`,
только с согласия Сергея.
