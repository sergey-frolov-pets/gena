#!/usr/bin/env bash
# Установка Gena server на Linux с systemd.
#
# Запуск из каталога server/ (там, где лежит этот файл):
#   sudo bash install.sh
#
# Что делает:
#   1. создаёт системного пользователя gena и каталоги;
#   2. собирает бинарник (нужен Go) либо берёт готовый из ./gena-server;
#   3. генерирует токен доступа и кладёт в /etc/gena-server/token (0600);
#   4. ставит и запускает systemd-юнит gena-server.
set -euo pipefail

PORT="${GENA_PORT:-8787}"
# GENA_ADDR перекрывает адрес целиком: GENA_ADDR=127.0.0.1:8787 — только локально.
ADDR="${GENA_ADDR:-:${PORT}}"
PREFIX="/opt/gena-server"
CONF="/etc/gena-server"
DATA="/var/lib/gena-server"
UNIT="/etc/systemd/system/gena-server.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "нужны права root: sudo bash install.sh" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd не найден — используйте Docker (см. README.md)" >&2
  exit 1
fi

id -u gena >/dev/null 2>&1 || useradd --system --home-dir "${DATA}" --shell /usr/sbin/nologin gena
install -d -m 0755 "${PREFIX}"
install -d -m 0750 -o gena -g gena "${DATA}"
# Каталог и токен принадлежат gena: служба работает под этим пользователем и читает
# токен сама; root-владелец с 0600 даёт «permission denied» на старте.
install -d -m 0750 -o gena -g gena "${CONF}"

if [[ -x "./gena-server" ]]; then
  install -m 0755 ./gena-server "${PREFIX}/gena-server"
elif command -v go >/dev/null 2>&1; then
  echo "собираю бинарник…"
  GOFLAGS=-mod=mod CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "${PREFIX}/gena-server" .
else
  echo "нет ни ./gena-server, ни go — соберите бинарник и положите рядом с install.sh" >&2
  exit 1
fi

if [[ ! -s "${CONF}/token" ]]; then
  # 32 байта из /dev/urandom в hex: токен нужен длинный, его вводят в браузере.
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${CONF}/token"
  echo "токен создан: ${CONF}/token"
fi
chown gena:gena "${CONF}/token"
chmod 0600 "${CONF}/token"

# Файл серверных агентов: ключи провайдеров живут только здесь, на сервере.
# Готовый образец с заглушками лежит рядом с install.sh. Файл читается на
# каждый запрос, поэтому правка состава агентов не требует рестарта службы.
if [[ ! -f "${CONF}/agents.json" && -f "./agents.example.json" ]]; then
  install -m 0640 -o gena -g gena ./agents.example.json "${CONF}/agents.json"
  echo "создан ${CONF}/agents.json из образца — впишите свои ключи"
fi

cat > "${UNIT}" <<EOF
[Unit]
Description=Gena server (диалоги Gena)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gena
Group=gena
ExecStart=${PREFIX}/gena-server -addr ${ADDR} -data ${DATA} -token-file ${CONF}/token -name "Gena"
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DATA}
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now gena-server
sleep 1
systemctl --no-pager --lines=5 status gena-server || true

TOKEN="$(cat "${CONF}/token")"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Готово."
echo "  адрес: http://${IP:-127.0.0.1}:${PORT}"
echo "  токен: ${TOKEN}"
echo
echo "В Gena: Подключения → «Добавить сервер Gena» → адрес и токен выше."
echo "Если сервер за прокси — включите HTTPS и проксируйте /api на ${ADDR}."
