# Подключение PicoClaw к Gena (протокол `pico_ws`)

Короткая инструкция: что должно быть в PicoClaw и что вписать в Gena.

## 1. Сторона PicoClaw

Публичный вход в канал Pico: `wss://stats.code2graph.ru/pico/ws`
(Caddy → `127.0.0.1:18790`, где слушает gateway).

В `config.json` (секция `channel_list.pico`) должно быть:

```json
"pico": {
  "enabled": true,
  "type": "pico",
  "settings": {
    "allow_origins": [
      "https://sergey-frolov-pets.github.io",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173"
    ],
    "streaming": { "enabled": false },
    "ping_interval": 30,
    "read_timeout": 60,
    "max_connections": 10
  }
}
```

- `allow_origins` — домены, с которых браузеру разрешено подключаться.
  Ветка GitHub Pages и локальная разработка (`npm run dev`, `npm run preview`).
  **Пустой список = разрешено всем.**
- `streaming.enabled` — оставляем `false`: Gena не разбирает `message.update`,
  при включённом стриминге ответ приходит кусками и дублируется.
- Токен в `config.json` **не хранится** — секреты PicoClaw держит отдельно,
  в `~/.picoclaw/.security.yml` (`channel_list.pico.settings.token`).

Посмотреть токен:

```bash
grep -A3 "^  pico:" ~/.picoclaw/.security.yml
```

Перевыпустить токен (старые клиенты отвалятся):

```bash
curl -X POST http://127.0.0.1:18790/api/pico/token   # только из launcher-сессии
# либо вручную: заменить token в .security.yml и перезапустить gateway
```

После правки `config.json`/`.security.yml` нужен перезапуск gateway
(`picoclaw gateway restart`) — hot reload канала не делает.

## 2. Сторона Gena

«Подключения» → форма нового агента:

| Поле | Значение |
|---|---|
| Имя | `Pico` (любое) |
| Протокол | **Pico WS** |
| WS URL | `wss://stats.code2graph.ru` — Gena сама допишет `/pico/ws` |
| Ключ | токен из `.security.yml` (шаг 1) |
| Лимит вызовов в сутки | по желанию, `0` — без лимита |
| Размер контекста | для `pico_ws` не используется: история живёт на сервере |

Дальше «Проверить» — должно быть `ok`, затем «Сохранить».

### Локально без Caddy

Если открываете Gena через `npm run dev` и хотите ходить в gateway напрямую:

- WS URL: `ws://127.0.0.1:18790`
- Origin браузера будет `http://localhost:5173` — он уже в `allow_origins`.

## 3. Как устроено соединение (что важно при отладке)

- Auth — subprotocol `token.<token>` (заголовки в браузерном WebSocket нельзя).
- `session_id` передаётся **в query при коннекте**
  (`wss://host/pico/ws?session_id=<id сессии Gena>`), иначе сервер ответит
  «no active connections». Контекст диалога хранится на сервере по этому id.
- Конец хода — `typing.stop`; страховки клиента — 3 с тишины и жёсткий таймаут 120 с.
- Вложения: `payload.media` принимает **только изображения** (`data:image/…`).
  Поэтому pdf/docx/xlsx/txt/md/csv Gena превращает в текст на клиенте и шлёт
  в самом сообщении.

Проверка «соединение живое» без Gena:

```bash
python3 tmp/check_pico_ws.py   # 101 Switching Protocols = токен и Origin приняты
```
