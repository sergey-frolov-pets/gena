package main

import (
	"net/http/httptest"
	"testing"
)

// issueScoped выпускает гостевой код с областью проектов.
func issueScoped(t *testing.T, srv *httptest.Server, label string, projects []string) (string, string) {
	t.Helper()
	status, raw := do(t, srv, "POST", "/api/access", map[string]any{
		"label":    label,
		"projects": projects,
	}, "secret")
	if status != 201 {
		t.Fatalf("выпуск кода с областью: %d %s", status, raw)
	}
	out := decode[struct {
		Code   string     `json:"code"`
		Access AccessView `json:"access"`
	}](t, raw)
	return out.Access.ID, out.Code
}

func makeProject(t *testing.T, srv *httptest.Server, name string) Project {
	t.Helper()
	status, raw := do(t, srv, "POST", "/api/projects", map[string]any{"name": name}, "secret")
	if status != 201 {
		t.Fatalf("проект %s: %d %s", name, status, raw)
	}
	return decode[Project](t, raw)
}

func sessionIn(t *testing.T, srv *httptest.Server, projectID string) Session {
	t.Helper()
	body := map[string]any{"title": "Диалог"}
	if projectID != "" {
		body["projectId"] = projectID
	}
	status, raw := do(t, srv, "POST", "/api/sessions", body, "secret")
	if status != 201 {
		t.Fatalf("сессия в проекте %q: %d %s", projectID, status, raw)
	}
	return decode[Session](t, raw)
}

func TestGuestScopeLimitsProjectsAndSessions(t *testing.T) {
	srv, _ := newAuthServer(t)
	alpha := makeProject(t, srv, "Альфа")
	beta := makeProject(t, srv, "Бета")
	inAlpha := sessionIn(t, srv, alpha.ID)
	inBeta := sessionIn(t, srv, beta.ID)
	free := sessionIn(t, srv, "")

	_, guest := issueScoped(t, srv, "Гость Альфы", []string{alpha.ID})

	// Список диалогов — только свой проект.
	status, raw := do(t, srv, "GET", "/api/sessions", nil, guest)
	if status != 200 {
		t.Fatalf("список: %d %s", status, raw)
	}
	list := decode[[]Session](t, raw)
	if len(list) != 1 || list[0].ID != inAlpha.ID {
		t.Fatalf("гость видит не только Альфу: %s", raw)
	}

	// Чужой и бесхозный диалог — 404, в том числе на экспорт.
	for _, id := range []string{inBeta.ID, free.ID} {
		status, _ = do(t, srv, "GET", "/api/sessions/"+id, nil, guest)
		if status != 404 {
			t.Fatalf("гость прочитал чужой диалог %s: %d", id, status)
		}
		status, _ = do(t, srv, "GET", "/api/sessions/"+id+"/export.md", nil, guest)
		if status != 404 {
			t.Fatalf("гость выгрузил чужой диалог %s: %d", id, status)
		}
	}

	// Проекты: виден один, чужой — 404, управление — 403.
	status, raw = do(t, srv, "GET", "/api/projects", nil, guest)
	listProjects := decode[[]Project](t, raw)
	if status != 200 || len(listProjects) != 1 || listProjects[0].ID != alpha.ID {
		t.Fatalf("гость видит чужие проекты: %d %s", status, raw)
	}
	status, _ = do(t, srv, "GET", "/api/projects/"+beta.ID, nil, guest)
	if status != 404 {
		t.Fatalf("гость прочитал чужой проект: %d", status)
	}
	status, _ = do(t, srv, "POST", "/api/projects", map[string]any{"name": "Свой"}, guest)
	if status != 403 {
		t.Fatalf("гость создал проект: %d", status)
	}
	status, _ = do(t, srv, "PATCH", "/api/projects/"+alpha.ID, map[string]any{"name": "Переименован"}, guest)
	if status != 403 {
		t.Fatalf("гость переименовал проект: %d", status)
	}
	status, _ = do(t, srv, "DELETE", "/api/projects/"+alpha.ID, nil, guest)
	if status != 403 {
		t.Fatalf("гость удалил проект: %d", status)
	}

	// Новые диалоги: без проекта и в чужой проект — 403, в свой — 201.
	status, _ = do(t, srv, "POST", "/api/sessions", map[string]any{"title": "В корне"}, guest)
	if status != 403 {
		t.Fatalf("гость создал диалог без проекта: %d", status)
	}
	status, _ = do(t, srv, "POST", "/api/sessions", map[string]any{"title": "В Бету", "projectId": beta.ID}, guest)
	if status != 403 {
		t.Fatalf("гость создал диалог в чужом проекте: %d", status)
	}
	status, raw = do(t, srv, "POST", "/api/sessions", map[string]any{"title": "В Альфе", "projectId": alpha.ID}, guest)
	if status != 201 {
		t.Fatalf("гость не создал диалог в своём проекте: %d %s", status, raw)
	}
	own := decode[Session](t, raw)
	if own.ProjectID != alpha.ID {
		t.Fatalf("диалог гостя попал не в тот проект: %s", raw)
	}

	// Перенос диалога в чужой проект и в корень — отказ.
	status, _ = do(t, srv, "PATCH", "/api/sessions/"+own.ID, map[string]any{"projectId": beta.ID}, guest)
	if status != 403 {
		t.Fatalf("гость перенёс диалог в чужой проект: %d", status)
	}
	status, _ = do(t, srv, "PATCH", "/api/sessions/"+own.ID, map[string]any{"projectId": ""}, guest)
	if status != 403 {
		t.Fatalf("гость вынес диалог из проекта: %d", status)
	}

	// Импорт: в чужой проект нельзя, в свой можно.
	importBody := map[string]any{
		"session":  map[string]any{"title": "Импорт", "projectId": beta.ID},
		"messages": []map[string]any{{"role": "user", "content": "привет"}},
	}
	status, _ = do(t, srv, "POST", "/api/sessions/s-import-beta/import", importBody, guest)
	if status != 403 {
		t.Fatalf("гость импортировал в чужой проект: %d", status)
	}
	importBody["session"] = map[string]any{"title": "Импорт", "projectId": alpha.ID}
	status, raw = do(t, srv, "POST", "/api/sessions/s-import-alpha/import", importBody, guest)
	if status != 200 {
		t.Fatalf("гость не импортировал в свой проект: %d %s", status, raw)
	}

	// Счётчики в карточке подключения — только по видимому.
	status, raw = do(t, srv, "GET", "/api/server", nil, guest)
	info := decode[map[string]any](t, raw)
	if status != 200 {
		t.Fatalf("сервер: %d %s", status, raw)
	}
	if info["sessions"].(float64) != 3 || info["projects"].(float64) != 1 {
		t.Fatalf("счётчики гостя считают чужое: %s", raw)
	}
	if info["scopeAll"].(bool) {
		t.Fatalf("у ограниченного гостя scopeAll=true: %s", raw)
	}

	// Владелец видит всё и не ограничен.
	status, raw = do(t, srv, "GET", "/api/sessions", nil, "secret")
	if all := decode[[]Session](t, raw); status != 200 || len(all) != 5 {
		t.Fatalf("владелец видит не всё: %d, %d %s", status, len(all), raw)
	}
	status, _ = do(t, srv, "PATCH", "/api/projects/"+beta.ID, map[string]any{"name": "Бета-2"}, "secret")
	if status != 200 {
		t.Fatalf("владелец не смог править проект: %d", status)
	}
}

func TestAccessScopePersistsAndCanBeLifted(t *testing.T) {
	srv, _, dir := newAuthServerDir(t)
	alpha := makeProject(t, srv, "Альфа")
	beta := makeProject(t, srv, "Бета")
	id, guest := issueScoped(t, srv, "Оба проекта", []string{alpha.ID, beta.ID})

	// Область сужаем до одного проекта.
	status, raw := do(t, srv, "PATCH", "/api/access/"+id, map[string]any{"projects": []string{alpha.ID}}, "secret")
	if status != 200 {
		t.Fatalf("сужение области: %d %s", status, raw)
	}
	if view := decode[AccessView](t, raw); len(view.Projects) != 1 || view.Projects[0] != alpha.ID {
		t.Fatalf("область не сузилась: %s", raw)
	}

	// Пустой список снимает ограничение — гость снова видит весь сервер.
	status, raw = do(t, srv, "PATCH", "/api/access/"+id, map[string]any{"projects": []string{}}, "secret")
	if status != 200 {
		t.Fatalf("снятие ограничения: %d %s", status, raw)
	}
	if view := decode[AccessView](t, raw); len(view.Projects) != 0 {
		t.Fatalf("ограничение не снялось: %s", raw)
	}
	status, raw = do(t, srv, "GET", "/api/server", nil, guest)
	if !decode[map[string]any](t, raw)["scopeAll"].(bool) || status != 200 {
		t.Fatalf("после снятия ограничения scopeAll=false: %d %s", status, raw)
	}

	// Снова ограничиваем и проверяем, что после перезапуска (перечитывания
	// access.json) ограничение на месте.
	do(t, srv, "PATCH", "/api/access/"+id, map[string]any{"projects": []string{beta.ID}}, "secret")
	reloaded, err := NewAccessStore(dir)
	if err != nil {
		t.Fatalf("перечитывание реестра: %v", err)
	}
	item, err := reloaded.Lookup(guest)
	if err != nil {
		t.Fatalf("код после перечитывания: %v", err)
	}
	if len(item.Projects) != 1 || item.Projects[0] != beta.ID {
		t.Fatalf("область не сохранилась: %+v", item.Projects)
	}
}

func TestAccessScopeRejectsUnknownProject(t *testing.T) {
	srv, _ := newAuthServer(t)
	status, raw := do(t, srv, "POST", "/api/access", map[string]any{
		"label":    "Опечатка",
		"projects": []string{"p-нет-такого"},
	}, "secret")
	if status != 400 {
		t.Fatalf("неизвестный проект принят: %d %s", status, raw)
	}
}

// health открыт всем, но счётчики в нём — по области доступа: гость с одним
// проектом не должен видеть размер всего сервера, а без токена цифр нет вовсе.
func TestHealthCountsFollowScope(t *testing.T) {
	srv, _ := newAuthServer(t)
	alpha := makeProject(t, srv, "Альфа")
	beta := makeProject(t, srv, "Бета")
	sessionIn(t, srv, alpha.ID)
	sessionIn(t, srv, alpha.ID)
	sessionIn(t, srv, beta.ID)
	_, guest := issueScoped(t, srv, "Альфа", []string{alpha.ID})

	// Без токена: жив/версия есть, счётчиков нет.
	status, raw := do(t, srv, "GET", "/api/health", nil, "")
	if status != 200 {
		t.Fatalf("health без токена: %d %s", status, raw)
	}
	anon := decode[map[string]any](t, raw)
	if anon["ok"] != true {
		t.Fatalf("health без токена не отвечает ok: %s", raw)
	}
	if _, ok := anon["sessions"]; ok {
		t.Fatalf("health без токена выдаёт размер сервера: %s", raw)
	}

	// Гость: только свои проект и диалоги.
	status, raw = do(t, srv, "GET", "/api/health", nil, guest)
	scoped := decode[map[string]any](t, raw)
	if status != 200 || scoped["sessions"].(float64) != 2 || scoped["projects"].(float64) != 1 {
		t.Fatalf("health гостя считает чужое: %d %s", status, raw)
	}
	if scoped["scopeAll"].(bool) || scoped["role"] != "guest" {
		t.Fatalf("health гостя: роль/область неверны: %s", raw)
	}
	if ids, ok := scoped["projectScope"].([]any); !ok || len(ids) != 1 || ids[0] != alpha.ID {
		t.Fatalf("health гостя: projectScope неверен: %s", raw)
	}

	// Владелец: всё и scopeAll.
	status, raw = do(t, srv, "GET", "/api/health", nil, "secret")
	owner := decode[map[string]any](t, raw)
	if status != 200 || owner["sessions"].(float64) != 3 || owner["projects"].(float64) != 2 {
		t.Fatalf("health владельца: %d %s", status, raw)
	}
	if !owner["scopeAll"].(bool) || owner["role"] != "owner" {
		t.Fatalf("health владельца: роль/область неверны: %s", raw)
	}
}
