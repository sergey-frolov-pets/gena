#!/usr/bin/env python3
"""Живая проверка доступов gena-server (роли, область проектов, режим просмотра).

Запуск на сервере или рядом с ним:

    python3 server/scripts/smoke-access.py
    python3 server/scripts/smoke-access.py --base https://api.gena-ai.space --token-file ./token
    python3 server/scripts/smoke-access.py --keep   # не удалять созданное

Токен владельца читается из файла (по умолчанию /etc/gena-server/token) и никогда
не печатается: в выводе только маски. Скрипт создаёт проект, два диалога и два кода
доступа, всё убирает за собой; при ошибке возвращает код 1.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

ok_all = True


def call(base, method, path, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            raw = res.read().decode()
            return res.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = {"raw": raw[:200]}
        return e.code, payload


def check(name, got, want):
    global ok_all
    good = got == want
    ok_all = ok_all and good
    print(("  OK   " if good else "  FAIL ") + f"{name}: {got} (ждали {want})")


def msg(text):
    return {"role": "user", "content": text}


def main():
    parser = argparse.ArgumentParser(description="smoke-проверка доступов gena-server")
    parser.add_argument("--base", default="http://127.0.0.1:8787")
    parser.add_argument("--token-file", default="/etc/gena-server/token")
    parser.add_argument("--keep", action="store_true", help="не удалять созданные объекты")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    master = open(args.token_file, encoding="utf-8").read().strip()
    cleanup = []

    print("0) сервер")
    status, health = call(base, "GET", "/api/health", master)
    check("health", status, 200)
    print("       версия:", health.get("version", "?"))

    print("1) владелец готовит проект и два диалога")
    status, project = call(base, "POST", "/api/projects", master, {"name": "smoke доступ A"})
    pid = project.get("id") or (project.get("project") or {}).get("id")
    check("создан проект", status, 201)
    if pid:
        cleanup.append(("/api/projects/" + pid,))

    _, body = call(base, "POST", "/api/sessions", master,
                   {"title": "smoke в проекте", "agent": "pico", "projectId": pid})
    inside = (body.get("session") or {}).get("id") or body.get("id")
    _, body = call(base, "POST", "/api/sessions", master, {"title": "smoke без проекта", "agent": "pico"})
    outside = (body.get("session") or {}).get("id") or body.get("id")
    check("два диалога созданы", bool(inside and outside), True)
    for sid in (inside, outside):
        if sid:
            cleanup.append(("/api/sessions/" + sid,))

    _, created = call(base, "POST", "/api/access", master, {"label": "smoke полный", "projects": []})
    full = created.get("code", "")
    if (created.get("access") or {}).get("id"):
        cleanup.insert(0, ("/api/access/" + created["access"]["id"],))
    _, created = call(base, "POST", "/api/access", master, {"label": "smoke проект A", "projects": [pid]})
    narrow = created.get("code", "")
    if (created.get("access") or {}).get("id"):
        cleanup.insert(0, ("/api/access/" + created["access"]["id"],))
    check("выпущены два кода", bool(full and narrow), True)

    print("2) полный гость: видит всё, пишет при continuation=all")
    call(base, "PATCH", "/api/sessions/" + inside, master, {"continuation": "all"})
    status, _ = call(base, "GET", "/api/sessions/" + inside, full)
    check("читает диалог в проекте", status, 200)
    status, _ = call(base, "GET", "/api/sessions/" + outside, full)
    check("читает диалог без проекта", status, 200)
    status, _ = call(base, "POST", "/api/sessions/" + outside + "/messages", full, msg("smoke"))
    check("пишет при all", status, 201)

    print("3) узкий гость: вне проекта — невидимо")
    status, info = call(base, "GET", "/api/server", narrow)
    check("роль", info.get("role"), "guest")
    status, _ = call(base, "GET", "/api/sessions/" + inside, narrow)
    check("свой проект виден", status, 200)
    status, _ = call(base, "GET", "/api/sessions/" + outside, narrow)
    check("чужой проект → 404", status, 404)
    status, _ = call(base, "POST", "/api/sessions/" + outside + "/messages", narrow, msg("smoke"))
    check("запись вне проекта → 403", status, 403)
    status, _ = call(base, "PATCH", "/api/sessions/" + outside, narrow, {"title": "переименую"})
    check("правка вне проекта → 403", status, 403)
    status, _ = call(base, "GET", "/api/access", narrow)
    check("коды доступов → 403", status, 403)

    print("4) режим «только смотреть» внутри своего проекта")
    status, _ = call(base, "PATCH", "/api/sessions/" + inside, master, {"continuation": "view"})
    check("владелец поставил view", status, 200)
    status, _ = call(base, "GET", "/api/sessions/" + inside, narrow)
    check("гость по-прежнему читает", status, 200)
    status, _ = call(base, "POST", "/api/sessions/" + inside + "/messages", narrow, msg("smoke при view"))
    check("запись при view → 403", status, 403)
    status, _ = call(base, "PATCH", "/api/sessions/" + inside, narrow, {"continuation": "all"})
    check("гость не снимает view", status, 403)
    status, _ = call(base, "PATCH", "/api/sessions/" + inside, master, {"continuation": "all"})
    check("владелец вернул all", status, 200)
    status, _ = call(base, "POST", "/api/sessions/" + inside + "/messages", narrow, msg("smoke при all"))
    check("запись при all → 201", status, 201)

    if args.keep:
        print("5) уборка пропущена (--keep), созданные объекты остались")
        print("   " + ", ".join(path for (path,) in cleanup))
    else:
        print("5) уборка")
        for (path,) in cleanup:
            call(base, "DELETE", path, master)
        print("       удалено объектов:", len(cleanup))

    print("\nИТОГ:", "всё сошлось" if ok_all else "есть расхождения")
    return 0 if ok_all else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, urllib.error.URLError) as err:
        print("не удалось связаться с сервером:", err)
        sys.exit(2)
