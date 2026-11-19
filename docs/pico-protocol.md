# Pico Protocol — разведка серверной стороны

_Источник: `picoclaw-src/pkg/channels/pico/` (`pico.go`, `protocol.go`, `client.go`, `init.go`) + `pkg/config/config.go` (PicoSettings)._
_Составлено для доработки Gena (мульти-протокольные агенты), 2026-11-19._

Ниже — точное поведение сервера Pico (канал `pico`), на который будет ходить Gena.
Ответы по каждому вопросу из плана разведки.

---

## 1. Endpoint и пути

- Канал регистрирует `WebhookPath() = "/pico/"`.
- `ServeHTTP` обрезает `/pico` и маршрутизирует:
  - `/pico/ws` и `/pico/ws/` → WebSocket (апгрейд).
  - `/pico/media/<refID>` → скачивание медиа (требует auth).
  - остальное → 404.
- Пример конфига: `url: "wss://remote-pico-server/pico/ws"`.

**Вывод:** базовый WS-URL для Gena — `wss://<host>/pico/ws`.

---

## 2. Auth (3 способа, по приоритету)

Сервер принимает токен тремя путями (функция `authenticate`):

1. **Заголовок `Authorization: Bearer <token>`** — для клиентов, умеющих ставить заголовки.
2. **Subprotocol `Sec-WebSocket-Protocol: token.<token>`** — для браузеров (заголовки на WS ставить нельзя).
3. **Query-параметр `?token=<token>`** — только если в конфиге `allow_token_query: true`.

**Важно — эхо subprotocol.** Если подан subprotocol `token.<token>`, сервер находит его
(`matchedSubprotocol`) и возвращает его же в response-заголовке `Sec-WebSocket-Protocol`.
Без этого эха браузер закроет соединение. Gena **обязан** слать subprotocol
`['token.' + token]` в `new WebSocket(url, protocols)`.

**Вывод:** для Gena единственный рабочий способ в браузере — subprotocol `token.<token>`.

---

## 3. CheckOrigin / allow_origins

```go
checkOrigin := func(r *http.Request) bool {
    if len(allowOrigins) == 0 { return true }   // пусто → разрешено ВСЁ
    origin := r.Header.Get("Origin")
    for _, allowed := range allowOrigins {
        if allowed == "*" || allowed == origin { return true }
    }
    return false
}
```

- `allow_origins` в конфиге: `[]string`. В `config.example.json` — **пустой массив** → разрешены все Origin.
- Если настроен — точное совпадение или `*`.

**Вывод:** страница на `https://<user>.github.io` работает из коробки при пустом `allow_origins`.
Если конкретная инсталляция Pico режет Origin — это правка **конфига** (добавить origin в `allow_origins`), не кода.

---

## 4. Wire-формат

Все сообщения — один тип `PicoMessage`:

```json
{ "type": "message.send", "id": "uuid", "session_id": "…", "timestamp": 1710000000000, "payload": { … } }
```

Поля `id`, `session_id`, `timestamp`, `payload` опциональны (`omitempty`). `timestamp` — Unix-миллисекунды.

---

## 5. Client → Server

| type | payload | примечания |
|---|---|---|
| `message.send` | `content` (string), `media` (inline data-URL изображений) | пустой content и нет media → ошибка `empty_content` |
| `media.send` | то же, что message.send | обрабатывается одинаково |
| `ping` | — | сервер отвечает `pong` с тем же `id` |

Inline-медиа: только data-URL `data:image/*;base64`, формат из
`{jpeg,png,gif,webp,bmp}`, максимум 20 МБ (`DefaultMaxMediaSize`).

---

## 6. Server → Client

| type | payload | примечания |
|---|---|---|
| `message.create` | `content`, `message_id`, `kind?`, `thought?`, `tool_calls?`, `model_name?`, `usage?`, `context_usage?`, `placeholder?`, `attachments?` | основное событие |
| `message.update` | `content`, `message_id`, `model_name?`, `context_usage?` | стриминг / правка уже созданного сообщения |
| `message.delete` | `message_id` | удаление сообщения |
| `media.create` | `content`, `attachments[]`, `message_id` | медиа как сообщение с `attachments` |
| `typing.start` / `typing.stop` | (пусто) | индикатор набора |
| `error` | `code`, `message`, `request_id?` | ошибка |
| `pong` | — | ответ на `ping` |

### `kind` и промежуточные сообщения

- `kind: "thought"` (+ `thought: true` — legacy-флаг для старых клиентов) → рассуждение/мышление.
- `kind: "tool_calls"` (+ `tool_calls` массив) → вызовы инструментов.
- **нет поля `kind`** → обычный финальный текст.

`model_name` — имя модели, `usage: {input_tokens, output_tokens, total_tokens}` — расход токенов за ход,
`context_usage: {used_tokens, total_tokens, history_tokens, compress_at_tokens, summarize_at_tokens, used_percent}` — заполненность контекстного окна.

---

## 7. Конец хода (typing.start → typing.stop)

Порядок событий за один ход агента:

1. `typing.start`
2. промежуточные `message.create` (`kind: thought` / `kind: tool_calls`)
3. финальный `message.create` (без `kind`)
4. `typing.stop`

`StartTyping` возвращает stop-функцию, которая вызывается **после** финального сообщения —
значит `typing.stop` всегда приходит после последнего `message.create`.
Gena резолвит промис ответа по `typing.stop` после ≥1 финального `message.create` (как в плане).

---

## 8. session_id — КРИТИЧНО (поправка к плану)

- **Сессия определяется на хендшейке.** Сервер читает `?session_id=` из URL при апгрейде.
  Если пусто — генерирует случайный UUID. Соединение регистрируется в
  `sessionConnections[этот_session_id]`.
- В `message.send` поле `session_id` **перекрывает** значение хендшейка (`handleMessageSend`):
  если оно задано и отличается, `chatID = "pico:<другое>"`, и при ответе
  `broadcastToSession` ищет `sessionConnections[<другое>]` → **пусто → ошибка "no active connections"**.

**Следствие:** передавать `session_id` ТОЛЬКО в теле `message.send` (как было в §3 плана) — **нельзя**,
соединение зарегистрировано под id хендшейка, и ответы не дойдут.

**Правильный способ для Gena:** класть `session_id` в URL при коннекте:

```
wss://<host>/pico/ws?session_id=<gena.sessionId>
```

и **не слать** `session_id` в теле `message.send` (тогда сервер использует id хендшейка).
Допустимо слать его и в теле, но только если значение совпадает с URL.

- Ответы (`message.create` и др.) несут `session_id` (тот же, что на хендшейке) — `broadcastToSession` проставляет его.
- Сервер хранит контекст по `session_id` (`chatID = "pico:" + sessionID`). Удаление сессии в Gena
  **не** очищает серверный контекст; импортированная сессия стартует с пустым серверным контекстом (как в плане).

---

## 9. Ошибки

- Тип `error`, payload `{code, message, request_id?}`. `request_id` — эхо `id` исходного `message.send`.
- Коды, встречающиеся в коде: `invalid_message`, `unknown_type`, `invalid_media`, `empty_content`.
- **HTTP-статусов нет** — это WebSocket. При неудачном хендшейке браузер отдаёт только `close 1006`
  без причины. Отличить «неверный токен» от «нет сети» нельзя → в UI одна общая ошибка
  «Не удалось подключиться: проверьте адрес, токен и wss://».

---

## 10. Лимиты и keepalive

- `max_connections` — максимум одновременных соединений (default **100**). При превышении —
  `close` с `CloseTryAgainLater`.
- `read_timeout` — default **60 с**; `ping_interval` — default **30 с**.
- Сервер шлёт `ping`-кадры каждые `ping_interval`; на `pong` продлевает read-deadline.
  Браузер отвечает `pong` автоматически — Gena ничего не делает.
- Буферы `ReadBufferSize/WriteBufferSize = 1024` (это размер буферов, **не** лимит кадра).
  Явного `SetReadLimit` на сервере нет — практический лимит кадра не задан.
- Inline-медиа: максимум 20 МБ.

---

## 11. Стриминг и placeholder (опционально на сервере)

- **Стриминг** (`streaming.enabled`): сервер шлёт `message.create` (первый кусок) и далее
  `message.update` с тем же `message_id` (накопленный `content`). Рассуждение стримится отдельным
  сообщением с `kind: thought` (свой `message_id`). Троттлинг: `throttle_seconds`, `min_growth_chars`.
- **Placeholder** (`placeholder.enabled`): сначала `message.create` с `placeholder: true`
  (случайный текст), потом правка реальным ответом через `message.update`.

Для Gena (P0) оба механизма необязательны: обычный путь без стриминга — один финальный
`message.create` без `kind`. Стриминг — P2.

---

## 12. Итог для Gena (что меняется в плане)

| Пункт плана | Итог разведки |
|---|---|
| Auth subprotocol `token.<token>` | ✅ подтверждено, эхо сервера есть — обязательно слать subprotocol |
| `Origin` / github.io | ✅ по умолчанию `allow_origins` пуст → разрешено всё |
| `typing.stop` в конце | ✅ всегда после финального `message.create` |
| `kind` значения | ✅ `thought` / `tool_calls` / отсутствует = текст |
| **session_id** | ⚠️ **передавать в URL-query при коннекте, не (только) в теле** — иначе «no active connections» |
| error payload | ✅ `{code, message, request_id}`; браузер даёт только `close 1006` |
| лимит кадра | без явного `SetReadLimit`; inline-медиа ≤ 20 МБ |
| контекст по session_id | ✅ серверный, история не шлётся |
