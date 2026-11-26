# Установка Gena server силами агента

Текст ниже — готовое задание агенту (PicoClaw, Claude Code и т. п.).
Скопируйте его целиком в чат с агентом, у которого есть SSH-доступ к серверу.

---

Задача: установить Gena server на этот сервер и вернуть мне адрес и токен.

1. Проверь окружение: `uname -a`, `free -m`, `df -h /`, есть ли `go` (`go version`)
   и `docker` (`docker --version`), свободен ли порт 8787 (`ss -ltnp | grep 8787`).
2. Если есть Go: склонируй репозиторий Gena (`https://github.com/sergey-frolov-pets/GenaClaw`),
   перейди в `server/` и выполни `sudo bash install.sh`.
   Если Go нет, но есть Docker: `docker build -t gena-server . && docker run -d ...`
   по инструкции из `server/README.md`. Если нет ни того, ни другого — поставь Go
   из репозитория дистрибутива и повтори.
3. Проверь, что служба жива: `systemctl status gena-server`, `curl -s 127.0.0.1:8787/api/health`.
   В ответе должно быть `"ok":true`.
4. Проверь доступ снаружи: открой порт в файрволе (`ufw allow 8787/tcp` или аналог)
   либо настрой прокси Caddy/Nginx с HTTPS на `127.0.0.1:8787` — предпочтительно HTTPS.
5. Создай первую сессию для проверки:
   `T=$(cat /etc/gena-server/token); curl -s -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"title":"Проверка"}' 127.0.0.1:8787/api/sessions`
   и удали её после проверки.
6. Верни мне: внешний адрес (с `https://`, если настроен прокси), токен из
   `/etc/gena-server/token`, версию из `/api/health`, путь к данным и команду перезапуска.

Ограничения: не трогай другие службы и не меняй существующие сайты; не открывай
порт наружу без токена; если порт 8787 занят — возьми 8788 и сообщи об этом.
