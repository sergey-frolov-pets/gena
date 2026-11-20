# Плагины Gena v2.1: кастомные UI внутри чата

_План, 2026-11-20. Заменяет v1 (`plan-plugins-20261120.md`). Правка Go разблокирована (RAM 781 МБ,
swap 1.7 ГБ), поэтому UI-блок вырезается из текста **на сервере**, а не парсится клиентом.
Ревью v2: `plan-plugins-review-kimi-v2.md` (kimi-k2.7-code, $0.029); принятые правки — §9._

## 0. Что изменилось против v1

| Было (v1) | Стало (v2.1) | Что решает |
|---|---|---|
| UI-блок внутри `content` | Go режет блок на финализации, `content` — чистое резюме | Kimi 1, 2, 8: копия, поиск, TTS, экспорт, история агенту |
| Клиент парсит стрим | Блок вырезается на сервере + клиент прячет хвост в дельтах | Kimi 3: пользователь не смотрит на JSON |
| «Тихие» реплики — костыль | `sendSilent()` + готовый payload | Kimi 5 |
| — | `blockId`, дедуп по `blockId+actionId`, блокировка до нового ответа | ревью v2, п.4 |
| — | Extract и в `message`-туле, и во всех publish-ветках | ревью v2, п.2, 5 |

## 1. Объём

| Плагин | Что показывает | Действия |
|---|---|---|
| `ozadachnik.tasks` | задачи по матрице (просрочено / сегодня / позже), статус-цвета, срок | готово, в работу, перенести, удалить |
| `backlog.board` | доска по статусам проекта, счётчики | в работу, закрыть, отложить, открыть |
| `notes.doc` | заметка или список заметок (текст, без markdown в первой волне) | открыть, «покажи связанные», копировать путь |
| `cron.alarms` | будильники: время, что, вкл/выкл | выключить, включить, удалить |

Плюс `gena.demo.checklist` — статичная карточка для ручной проверки без агента.

## 2. Контракт

### 2.1 Кадр `message.create`

```json
{
  "type": "message.create",
  "payload": {
    "message_id": "…",
    "content": "Задачи на сегодня: 7, три просрочены.",
    "ui": {
      "v": 1,
      "blockId": "oz-20261120-1",
      "plugin": "ozadachnik.tasks",
      "title": "Задачи",
      "data": { "view": "list", "items": [ … ] },
      "actions": [ … ]
    }
  }
}
```

- **`kind` не ставим.** Клиент до этой версии на незнакомый `kind` делает `return`
  (`pico-ws.ts:358`) — сообщение исчезло бы целиком. Ключ `ui` старый клиент игнорирует
  и показывает `content`.
- `content` — короткое резюме от агента; оно же уходит в историю, Telegram/VK, TTS, поиск.
- `ui` ≤ 64 КБ, `items` ≤ 200, строка ≤ 2000 символов, только http/https в `url`.
- Невалидный `ui` сервер не отправляет (одна запись в лог + пометка в тексте, см. §3.1).
- `blockId` — идентификатор снимка: по нему клиент коррелирует действие с ответом агента.

### 2.2 Что печатает агент

````
Задачи на сегодня: 7, три просрочены.

```gena-ui
{"v":1,"blockId":"oz-20261120-1","plugin":"ozadachnik.tasks","title":"Задачи","data":{…},"actions":[…]}
```
````

Правила: блок **последний**, **один** на сообщение, ограждение ``` ```gena-ui ```, JSON компактный.

### 2.3 Схема данных

```
data: {
  view: "list" | "table" | "board" | "card" | "text",
  items?: Item[],                  // list / table / board
  groups?: {key,label,items}[],    // board
  text?: string,                   // text / card
  empty?: string
}

Item:  { id, title, subtitle?, status?, due?, badges?: string[], checked?, disabled?, url? }
Action:{ id, label, scope: "item"|"view", style?: "primary"|"ghost"|"danger",
         send: string,                 // шаблон: {id} {title} {status} {value}
         confirm?: boolean,
         optimistic?: "remove"|"check"|"disable" }
```

Оформление пресетов (`tasks`, `board`, `alarms`) живёт внутри `GenericView` — отдельный
`presets.ts` не заводим, пока плагинов меньше пяти (ревью v2, п.2).

### 2.4 Действие пользователя

1. Тап → `confirm`? `ConfirmModal` : сразу.
2. Шаблон `"задача {id} выполнена"` → `"задача a1 выполнена"` (подстановка только из данных блока).
3. `optimistic` → карточка реагирует сразу; кнопки этого `itemId` гаснут.
4. Отправка — `sendSilent(agentId, sessionId, text)`: без `appendMessage`, без `messageCount`,
   но с `recordCall` и очередью; в ленте плашка «Отправлено агенту…» (4 с).
5. Блокировка снимается **новым сообщением ассистента в этой сессии** (не таймером 30 с):
   пришёл ответ с новым `blockId` — старые карточки разблокированы и помечены «устарело».
6. Дедуп: ключ `blockId + itemId + actionId`, окно 1.5 с.

Optimistic-состояние живёт в памяти (`Map<blockId:itemId:actionId, "pending">`), после
перезагрузки не восстанавливается намеренно: карточка показывает состояние из снимка,
а факт действия подтверждается новым снимком от агента.

## 3. Сервер (Go)

### 3.1 `pkg/uiblock`

| Файл | ~строк | Что делает |
|---|---|---|
| `pkg/uiblock/extract.go` | 130 | `Extract(text) (clean string, block json.RawMessage, ok bool)`; `Validate`; лимиты |
| `pkg/uiblock/extract_test.go` | 220 | 14 кейсов: валидный, битый JSON, два блока, блок не последний, > 64 КБ, CRLF, ограждение внутри ```, пустой блок |

Единые правила (ревью v2, п.3):

- вырезаются **все** ограждения с info-строкой `gena-ui`, где бы они ни стояли;
- из последнего валидного собирается `block`;
- JSON невалиден / больше лимита → `ok=false`: ограждение всё равно вырезано, `clean`
  дополняется пометкой `[ui-блок отброшен: <причина>]` (агент видит, что карточка не дошла),
  в лог — одна запись с `blockId` и размером;
- пустой результат после вырезки оставляем пустым, заглушку не подставляем.

### 3.2 Точки встраивания (все пути публикации)

| Путь | Файл | Правка |
|---|---|---|
| Основной ответ (`SendResponse=true`) | `pkg/agent/agent.go:590` | берём `result.uiPayload` → `msg.Context.Raw["ui"]` |
| Legacy interim pico | `pkg/agent/pipeline_finalize.go:85` | `outboundTurnMessageOptions.raw["ui"]` (поле уже есть) |
| `PublishResponseIfNeeded` (stop / cron / follow-up) | `pkg/agent/agent_outbound.go:64` | внутри `Extract(response)`: текст чистим, `ui` — в `Raw` рядом с `model_name` |
| `message`-тул | `pkg/tools/message*.go` | перед отправкой `Extract`; payload — только для pico, остальным каналам текст |
| История | `pkg/agent/pipeline_finalize.go:43` | `Extract` **до** `AddFullMessage`: история, суммаризация, Telegram/VK — чистые |
| Стрим | — | сервер не меняем: хвост прячет клиент (§4) |

`turnResult` получает поле `uiPayload json.RawMessage`. Новый метод `PublishResponseWithUI`
не заводим (ревью v2, п.4). Интерфейс в `pkg/tools/cron.go` не меняется.

### 3.3 Канал pico

`protocol.go:27` — `PayloadKeyUI = "ui"`; `pico.go:313` — если `Raw["ui"]` валидный JSON,
кладём в payload **объектом** (`json.Unmarshal` → `any`), иначе не кладём.

### 3.4 Сборка

```
free -m                       # цель: available ≥ 600 МБ
GOGC=20 GOMAXPROCS=1 go build -p=1 -gcflags=all=-l -o /tmp/picoclaw ./cmd/picoclaw
go test ./pkg/uiblock/ -count=1
go test ./pkg/channels/pico/ ./pkg/agent/ -run 'UI|Uiblock|Extract|Outbound' -count=1
```

Фоном + `poll`, один пакет за раз, `./...` не запускать. Если OOM повторится — фиксируем
в `tmp/BUILD_BLOCKER.md`, катим клиентскую половину с legacy-парсингом (§4.2).

## 4. Клиент (Vue)

```
ChatView.vue
  └─ <MessageBody :message="m" @action="onUiAction">
        ├─ текст (pre-wrap)
        ├─ <PluginHost :block="m.ui ?? legacyParse(m.content)">
        │     └─ GenericView (list | table | board | card | text)
        └─ вложения
```

### 4.1 Новые файлы

| Файл | ~строк | Что делает |
|---|---|---|
| `src/plugins/types.ts` | 70 | `UiBlock`, `UiAction`, `UiItem`, `PluginMeta` |
| `src/lib/ui-blocks.ts` | 150 | `validateBlock()` + legacy-парсинг ограждения (совместимость) |
| `src/lib/ui-stream.ts` | 40 | `stripUiTail(text)` — режет хвост с ```gena-ui в дельтах стрима |
| `src/lib/ui-actions.ts` | 90 | интерполяция, `applyOptimistic`, дедуп `blockId+itemId+actionId` |
| `src/lib/ui-text.ts` | 25 | `textOnly(content)` — только для старых сообщений с ограждением |
| `src/plugins/registry.ts` | 60 | `id → {meta, preset}`; включённые плагины (localStorage) |
| `src/plugins/PluginHost.vue` | 130 | рамка, заголовок, свернуть, `errorCaptured`, «устарело» |
| `src/plugins/GenericView.vue` | 340 | пять view + оформление пресетов внутри |
| `src/components/MessageBody.vue` | 110 | разбор сообщения, вызов хоста |
| `src/lib/message-body.ts` | 60 | чистые хелперы (тестируются без vue) |
| тесты | ~300 | `ui-blocks`, `ui-stream`, `ui-actions`, `PluginHost` |

### 4.2 Legacy-парсинг: почему остаётся

Kimi предложил выкинуть. Оставляю осознанно: прямой LLM-транспорт (`openai`, BYOK) и старые
серверы не имеют серверной вырезки — там блок придёт внутри текста. Кода это добавляет ~40 строк
(разделение строки и валидация общие), без него сценарий «подключил свою модель — карточки пропали»
выглядит как баг.

### 4.3 Правки существующего

| Файл | Правка |
|---|---|
| `src/storage/types.ts:97` | `Message.ui?: UiBlock` (миграция IndexedDB не нужна) |
| `src/lib/store.ts:217` | `appendMessage(sessionId, role, content, opts?: {kind?, attachments?, elapsedMs?, ui?})` — объект-опции вместо седьмого позиционного аргумента (ревью v2, п.7); правим ~10 вызовов, typecheck ловит пропуски |
| `src/lib/store.ts` | новый `sendSilent(agentId, sessionId, text)` |
| `src/lib/transports/types.ts:31` | `TransportReply.ui?`, `TransportMessage.ui?` |
| `src/lib/transports/pico-ws.ts:314` | `ui` из payload → `setFinal`; в `onDelta`/`onUpdate` — `stripUiTail` |
| `src/views/ChatView.vue:2179` | `<p>` → `<MessageBody>`; `onUiAction` ~25 строк |
| `src/views/ChatView.vue:2232,2250,1628` | копия / TTS / экспорт — через `textOnly(m.content)` |
| `src/i18n/*` | 9 ключей × 9 локалей (`chat.ui.*`) |
| `gena/PLAN.md` | раздел P5 |

Регистрация плагина — одна строка в `registry.ts`.

## 5. Этапы

| # | Что | Оценка | Готово, когда |
|---|---|---|---|
| G0 ✅ | `pkg/uiblock` + тесты | 1.5 ч | `go test ./pkg/uiblock/` зелёный, 17 кейсов (2026-11-20) |
| G1 ✅ | Extract в 5 точках (§3.2), `PayloadKeyUI`, pico payload, `turnResult.uiPayload` | 2.5 ч | реализовано 2026-11-20, см. §11 |
| C0 | контракт клиента: `types.ts`, `ui-blocks.ts`, `ui-stream.ts`, `ui-text.ts`, `appendMessage` на опции + тесты | 2 ч | визуально ничего не изменилось, тесты ≥ 200 |
| C1 | `PluginHost`, `GenericView` (5 view), `registry`, демо-плагин | 3 ч | карточка сворачивается на телефоне; битый блок = текст; падение плагина не роняет чат |
| C2 | `ui-actions`, `sendSilent`, confirm, optimistic, дедуп, i18n, копия/TTS/экспорт | 2 ч | «Готово» закрывает задачу (проверка `tasks_list`), реплики в ленте нет, двойной тап не дублирует |
| S1 | скилл `gena-ui` | 1 ч | «покажи задачи» → карточка без ручного JSON |
| P1 | пресеты `tasks`, `board`, `alarms` | 2.5 ч | «покажи беклог», «какие будильники» → карточки, действия меняют состояние |
| P2 | `notes.doc` (текст) | 1 ч | «покажи заметку про X» → карточка с текстом |
| F | полировка: `--panel`, ≤ 60 vvh, скролл в таблице, пустые состояния, `sw.js` → v11, `docs/plugins.md`; опционально markdown-рендер заметок | 2 ч | vue-tsc, тесты, build зелёные; ручной чек на телефоне |

Итого ≈ 17.5 ч — 4 сессии. Порядок: G0 → G1 → C0 → C1 → C2 → S1 → P1 → P2 → F.
G0 и C0 можно вести параллельно (разные репозитории).

## 6. Тесты

Go: `uiblock` (14), pico payload `ui` (3), история без блока (2), `message`-тул без блока (2),
E2E-кадр: агент вернул текст с блоком → `message.create` содержит `ui`-объект и чистый `content` (1).

TS: `ui-blocks` (10), `ui-stream` (5), `ui-actions` (9), `PluginHost` (4, нужен `@vue/test-utils`),
`pico-ws` ui-payload + стрим-хвост (3), `message-body` (5).

Проверки перед сдачей:

```
go test ./pkg/uiblock/ ./pkg/channels/pico/ ./pkg/agent/
npm run typecheck && npm run test && npm run build
python3 skills/code-review-hook/scripts/check_code.py --git
```

## 7. Риски

| Риск | Смягчение |
|---|---|
| Go-сборка OOM | один пакет, `-p=1 -gcflags=all=-l`, фон; fallback — клиентский legacy-парсинг (§4.2) |
| Рестарт gateway посреди сессии | G1 отдельным окном, после — `journalctl -u picoclaw` + пинг через Гену |
| Стрим показывает JSON | `stripUiTail` в `onDelta`/`onUpdate`, тест «хвост разрезан между кадрами» |
| Блок ушёл через `message`-тул | Extract в туле + тест; иначе история грязная |
| Агент печатает кривой JSON | вырезка + пометка `[ui-блок отброшен]`; скилл учит повторять короче |
| Карточка потеряна при обрыве связи | осознанно: не восстанавливаем; «покажи ещё раз» = новый снимок |
| Действия спамят агента | дедуп 1.5 с, очередь, дневной лимит вызовов |
| Модель вставляет HTML | рендер текстовыми нодами, `url` только http/https |

## 8. Чего нет в этой итерации

- Сторонние плагины с сервера, iframe-песочница.
- Формы с вводом (input/textarea).
- Живое обновление карточки без нового сообщения.
- `kind: "ui"` — ломает старые клиенты (`pico-ws.ts:358`); вернуться можно только
  после фиче-флага версии клиента.

## 9. Ревью v2 (Kimi) — что принято

Полный текст: `docs/plan-plugins-review-kimi-v2.md`. Стоимость $0.029.

| Замечание | Вердикт | Где в плане |
|---|---|---|
| Стрим показывает сырой блок | **принято** (клиентский скрыватель хвоста) | §4.1 `ui-stream.ts`, §5 C0, §7 |
| `message`-тул обходит Extract | **принято** | §3.2 строка «message-тул» |
| Правила Extract противоречат друг другу, агент не знает об отбросе | **принято** | §3.1 пометка `[ui-блок отброшен]` + лог |
| Нет `blockId`, дедуп и optimistic хрупкие, таймер 30 с | **принято** | §2.1, §2.4 п.5–6 |
| `ui` теряется при обрыве, пути публикации не все | **принято** | §3.2 таблица всех путей, §7 «осознанно» |
| Убрать `PublishResponseWithUI` | **принято** | §3.2 `turnResult.uiPayload` + `raw` |
| `appendMessage` — объект-опции | **принято** | §4.3 |
| Убрать legacy-парсинг | **отклонено** | §4.2: BYOK/старый сервер |
| Убрать свой markdown, первая волна — текст | **принято** | §5 F — опционально |
| Пресеты — отдельный файл не нужен | **принято** | §2.3 |
| Ветка «понять kind:"ui"» — мёртвый код | **принято** | убрана из §4.3 |
| E2E-тест кадра | **принято** | §6 |

Ставка «no kind, только ключ `ui`» подтверждена ревью по коду `pico-ws.ts:354–358`
и оставлена без изменений.

## 10. Второй прогон ревью (v2b) — дополнительно принято

Первый прогон упал в reasoning и перезаписал файл; перезапуск дал другой текст
(`tmp/kimi_review_v2b.md`, $0.033). Новое по сравнению с §9:

| Замечание | Вердикт | Что в плане |
|---|---|---|
| Extract должен быть **одной** точкой, чистый текст обязан перезаписать `ts.setFinalContent` и `turnResult`, иначе суммаризация/экспорт получат JSON | **принято** | §3.2: «История» — правим `finalContent` до `setFinalContent`, `AddFullMessage`, streaming-finalize и interim publish |
| Финальный кадр стрима — `message.update`, а не `create`; `ui` там теряется | **принято** | §3.2 новая строка «Стрим-финал»: `pico.go` + `EditMessageWithPayload` (`pkg/channels/manager.go:468`) несут `ui`; новый клиент читает `ui` и из `update` |
| `blockId` может совпасть в двух ответах → блокировка «до нового blockId» не работает | **принято** | §2.4 п.6: ключ дедупа `messageId + blockId + itemId + actionId` |
| Агрессивная вырезка всех ограждений | **отклонено** | info-строка `gena-ui` наша, случайных совпадений нет; оставлять JSON в истории дороже по токенам, чем риск |
| Runtime legacy-парсинг → миграция IndexedDB | **принято частично** | для сообщений, сохранённых до релиза, `MessageBody` показывает текст с ограждением и разбирает его на месте; отдельная миграция не нужна, `ui-text.ts` остаётся |
| `sendSilent` скрыт от истории, «ломает воспроизводимость» | **отклонено** | намеренное решение Сергея (v1): действие не мусорит ленту; корреляция по `blockId` в новом снимке |
| In-memory optimistic Map с тройным ключом | **принято частично** | оставляем Map, но ключ включает `messageId`; снимается новым сообщением ассистента |
| Тесты на разрывы JSON между кадрами `update` | **принято** | §6: `ui-stream` (5) + `pico-ws` (3) покрывают разрыв «```gena-ui» и «JSON в двух кадрах» |

Обе ставки подтверждены: `ui` без нового `kind` — безопасно; вырезка не ломает регенерацию,
если чистый текст доезжает до истории и `turnResult`.

## 11. Реализация G0/G1 (2026-11-20)

### G0 — `pkg/uiblock` (коммит `036b1be6`)

`Extract(text) Result{Clean, Block, Plugin, Dropped}` + `Validate`. 17 тестов.
Правила: вырезаются все ограждения с info-строкой `gena-ui`; блок — последний валидный;
битый JSON вырезается и заменяется пометкой `[ui-блок отброшен: <причина>]`.
Попутный фикс: если слово `gena-ui` встретилось в прозе без ограждения, текст
возвращается байт в байт (раньше нормализовались CRLF и пустые строки).

### G1 — встраивание

| Место | Файл | Что сделано |
|---|---|---|
| Точка вырезки | `pkg/agent/pipeline_finalize.go` | `extractUI(finalContent)` до `setFinalContent`, истории, суммаризации и стрима; блок → `turnResult.uiPayload` |
| Промежуточные ответы | `pkg/agent/pipeline_llm.go` | текст перед tool-calls чистится, блок запоминается в `ts.uiPayload` (`setPendingUI`) и доезжает финальным ответом |
| Основная отправка | `pkg/agent/agent.go` | `result.uiPayload` → `Context.Raw["ui"]` |
| `PublishResponseIfNeeded` | `pkg/agent/agent_outbound.go` | stop / cron / steering / follow-up: текст чистится, `ui` в `Raw` |
| `message`-тул | `pkg/tools/integration/message.go` | блок вырезается всегда; для карточек — отдельный `SetSendCardCallback` (старые колбэки не тронуты) |
| Стрим-финал | `pkg/agent/pipeline_streaming.go`, `pkg/bus` | новый `bus.UIStreamer.SetUIPayload`; publisher передаёт блок в финальный кадр |
| pico | `pkg/channels/pico/pico.go`, `protocol.go` | `PayloadKeyUI="ui"`; объект в `message.create` и `message.update`; `picoStreamer` шлёт финальный update даже при неизменном тексте, если появился блок |
| Правка placeholder | `pkg/channels/manager.go` | `outboundMessageEditPayload` кладёт `ui` объектом; обёртки стримеров (`finalizeHookStreamer`, `splitMarkerStreamer`) пробрасывают `SetUIPayload` |

Тесты: `uiblock` 17, `agent` (glue + publish) 5, `pico` +3 (create/update/битый ui),
`channels` +2 (payload правки), `tools/integration` +2 (карточка и вырезка без колбэка).

### Что осталось по G1

- Перезапуск gateway на новом бинаре и проверка, что Гена отвечает.
- Ручной E2E: скилл печатает ```gena-ui``` → в кадре `ui`-объект, история чистая.
- Клиентская половина (C0–C2): без неё блок игнорируется старым клиентом, текст остаётся чистым.
