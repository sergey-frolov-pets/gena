# Gena server

Серверная часть Gena: хранит диалоги и отдаёт их клиенту по HTTP.
Один статический бинарник, без базы данных и внешних зависимостей —
сессии лежат JSON-файлами в каталоге данных.

## Быстрый старт

```bash
# из каталога server/
go build -o gena-server .
GENA_TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  ./gena-server -addr :8787 -data ./data -name "Gena"
```

Проверка:

```bash
curl -s localhost:8787/api/health
# {"ok":true,"name":"Gena","sessions":0,"version":"1.0.0",...}
```

## Установка

### Вариант 1 — на сервер к своему агенту (systemd)

```bash
cd server
sudo bash install.sh
```

Скрипт создаст пользователя `gena`, соберёт бинарник, сгенерирует токен
в `/etc/gena-server/token` и запустит службу `gena-server`.
Данные — `/var/lib/gena-server`, порт — `8787` (`GENA_PORT=9000 sudo bash install.sh`).

### Вариант 2 — на любой сервер (Docker)

```bash
cd server
docker build -t gena-server .
docker run -d --name gena-server \
  -p 8787:8787 \
  -v gena-data:/data \
  -e GENA_TOKEN="$(openssl rand -hex 32)" \
  gena-server
```

### Вариант 3 — готовый бинарник

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o gena-server .
scp gena-server root@server:/opt/gena-server/gena-server
```

Дальше — `install.sh` (он подхватит готовый бинарник рядом с собой).

## Подключение в Gena

«Подключения» → «Добавить сервер Gena» → адрес (`https://gena.example.com`)
и токен. Кнопка «Проверить» обращается к `/api/health`, сохранение — после проверки.

## Настройки

| Флаг | Переменная | По умолчанию | Смысл |
|---|---|---|---|
| `-addr` | `GENA_ADDR` | `:8787` | адрес и порт |
| `-data` | `GENA_DATA` | `/var/lib/gena-server` | каталог данных |
| `-token` | `GENA_TOKEN` | — | токен доступа |
| `-token-file` | `GENA_TOKEN_FILE` | — | файл с токеном |
| `-cors` | `GENA_CORS` | `*` | разрешённые Origin через запятую |
| `-name` | `GENA_NAME` | `Gena server` | имя в интерфейсе |
| `-no-auth` | — | выкл. | без токена, только для локальной отладки |

## API

Все методы, кроме `/api/health`, требуют `Authorization: Bearer <токен>`.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | проверка связи, без токена |
| GET | `/api/server` | имя, версия, число сессий |
| GET | `/api/sessions` | список сессий |
| POST | `/api/sessions` | создать `{title, agentId}` |
| GET | `/api/sessions/{id}` | сессия + сообщения |
| PATCH | `/api/sessions/{id}` | `{title, pinned, tags}` |
| DELETE | `/api/sessions/{id}` | удалить сессию |
| POST | `/api/sessions/{id}/messages` | добавить сообщение |
| PATCH | `/api/sessions/{id}/messages/{msg}` | правка текста |
| DELETE | `/api/sessions/{id}/messages/{msg}` | удалить сообщение |
| POST | `/api/sessions/{id}/import` | полная синхронизация с клиента |
| GET | `/api/sessions/{id}/export.md` | диалог в markdown |

Пример:

```bash
TOKEN=$(cat /etc/gena-server/token)
curl -s -H "Authorization: Bearer $TOKEN" localhost:8787/api/sessions
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Вклады"}' localhost:8787/api/sessions
```

## Данные и резервные копии

```
/var/lib/gena-server/sessions/<id>.json   # один диалог = один файл
```

Файл — `{session, messages}`, запись атомарная (временный файл + rename).
Копия: `tar czf gena-$(date +%F).tgz -C /var/lib gena-server`.
Восстановление: распаковать обратно и `systemctl restart gena-server`.

## Безопасность

- Токен обязателен; без него сервер не стартует.
- Наружу — только HTTPS (Caddy/Nginx), `/api` проксируется на `127.0.0.1:8787`.
- Токен — это доступ ко всей переписке: не пересылать в мессенджерах,
  при утечке сгенерировать новый файл токена и перезапустить службу.
- CORS по умолчанию `*`: любой сайт может обратиться к API, но без токена
  ничего не прочитает. Сузить можно `-cors https://gena-ai.space`.

## Обновление

```bash
cd server && git pull
sudo bash install.sh      # пересоберёт и перезапустит
```

## Тесты

```bash
go test ./...
```
