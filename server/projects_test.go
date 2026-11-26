package main

import (
	"testing"
)

// Проекты: создание, состав, привязка сессии, каскад при удалении.
func TestProjectCRUD(t *testing.T) {
	srv := newTestServer(t)

	code, raw := do(t, srv, "POST", "/api/sessions", map[string]any{"title": "Первая"}, "secret")
	if code != 201 {
		t.Fatalf("сессия: код %d, %s", code, raw)
	}
	session := decode[Session](t, raw)

	code, raw = do(t, srv, "POST", "/api/projects", map[string]any{
		"name":       "Пенсия",
		"sessionIds": []string{session.ID},
	}, "secret")
	if code != 201 {
		t.Fatalf("проект: код %d, %s", code, raw)
	}
	project := decode[Project](t, raw)
	if project.Name != "Пенсия" || len(project.Sessions) != 1 {
		t.Fatalf("проект разобран неверно: %+v", project)
	}

	// Привязка сессии через PATCH: projectId появляется в отдаче сессии.
	code, raw = do(t, srv, "PATCH", "/api/sessions/"+session.ID,
		map[string]any{"projectId": project.ID}, "secret")
	if code != 200 {
		t.Fatalf("patch сессии: код %d, %s", code, raw)
	}
	if got := decode[Session](t, raw); got.ProjectID != project.ID {
		t.Fatalf("projectId не применился: %+v", got)
	}

	// Несуществующий проект не привязывается.
	code, _ = do(t, srv, "PATCH", "/api/sessions/"+session.ID,
		map[string]any{"projectId": "p_none"}, "secret")
	if code != 404 {
		t.Fatalf("ожидал 404 для чужого проекта, получил %d", code)
	}

	// Удаление проекта открепляет сессии, но не удаляет их.
	code, raw = do(t, srv, "DELETE", "/api/projects/"+project.ID, nil, "secret")
	if code != 200 {
		t.Fatalf("delete проекта: код %d, %s", code, raw)
	}
	code, raw = do(t, srv, "GET", "/api/sessions/"+session.ID, nil, "secret")
	if code != 200 {
		t.Fatalf("сессия пропала: код %d", code)
	}
	payload := decode[struct {
		Session Session `json:"session"`
	}](t, raw)
	if payload.Session.ProjectID != "" {
		t.Fatalf("сессия осталась в удалённом проекте: %+v", payload.Session)
	}
}

// Саммари сессии: сохраняется, отдаётся, стареет после нового сообщения.
func TestSessionSummaryStale(t *testing.T) {
	srv := newTestServer(t)
	_, raw := do(t, srv, "POST", "/api/sessions", map[string]any{"title": "Диалог"}, "secret")
	session := decode[Session](t, raw)
	do(t, srv, "POST", "/api/sessions/"+session.ID+"/messages",
		map[string]any{"role": "user", "content": "привет"}, "secret")

	code, raw := do(t, srv, "POST", "/api/sessions/"+session.ID+"/summary",
		map[string]any{"text": "кратко: поздоровались", "model": "ds-pro"}, "secret")
	if code != 200 {
		t.Fatalf("саммари: код %d, %s", code, raw)
	}
	saved := decode[Session](t, raw)
	if saved.Summary == nil || saved.Summary.Stale {
		t.Fatalf("саммари не сохранилось: %+v", saved.Summary)
	}
	if saved.Summary.Model != "ds-pro" {
		t.Fatalf("модель потерялась: %+v", saved.Summary)
	}

	// Новое сообщение меняет ревизию — саммари помечается устаревшим.
	do(t, srv, "POST", "/api/sessions/"+session.ID+"/messages",
		map[string]any{"role": "assistant", "content": "здравствуйте"}, "secret")
	_, raw = do(t, srv, "GET", "/api/sessions/"+session.ID, nil, "secret")
	payload := decode[struct {
		Session Session `json:"session"`
	}](t, raw)
	if payload.Session.Summary == nil || !payload.Session.Summary.Stale {
		t.Fatalf("ожидал устаревшее саммари: %+v", payload.Session.Summary)
	}

	// Переименование сессии саммари не обесценивает.
	code, raw = do(t, srv, "POST", "/api/sessions/"+session.ID+"/summary",
		map[string]any{"text": "кратко: поздоровались", "model": "ds-pro"}, "secret")
	if code != 200 {
		t.Fatalf("пересчёт саммари: код %d", code)
	}
	do(t, srv, "PATCH", "/api/sessions/"+session.ID, map[string]any{"title": "Новое имя"}, "secret")
	_, raw = do(t, srv, "GET", "/api/sessions/"+session.ID, nil, "secret")
	payload = decode[struct {
		Session Session `json:"session"`
	}](t, raw)
	if payload.Session.Summary == nil || payload.Session.Summary.Stale {
		t.Fatalf("переименование не должно старить саммари: %+v", payload.Session.Summary)
	}

	// Удаление саммари.
	code, raw = do(t, srv, "DELETE", "/api/sessions/"+session.ID+"/summary", nil, "secret")
	if code != 200 {
		t.Fatalf("delete саммари: код %d, %s", code, raw)
	}
	if got := decode[Session](t, raw); got.Summary != nil {
		t.Fatalf("саммари не удалилось: %+v", got.Summary)
	}
}

// Саммари проекта: считается по всем сессиям проекта, стареет при изменении любой.
func TestProjectSummary(t *testing.T) {
	srv := newTestServer(t)
	_, raw := do(t, srv, "POST", "/api/sessions", map[string]any{"title": "A"}, "secret")
	first := decode[Session](t, raw)
	_, raw = do(t, srv, "POST", "/api/sessions", map[string]any{"title": "B"}, "secret")
	second := decode[Session](t, raw)
	do(t, srv, "POST", "/api/sessions/"+first.ID+"/messages",
		map[string]any{"role": "user", "content": "про акции"}, "secret")

	_, raw = do(t, srv, "POST", "/api/projects", map[string]any{
		"name":       "Портфель",
		"sessionIds": []string{first.ID, second.ID},
	}, "secret")
	project := decode[Project](t, raw)

	code, raw := do(t, srv, "POST", "/api/projects/"+project.ID+"/summary",
		map[string]any{"text": "проект про портфель", "model": "kimi"}, "secret")
	if code != 200 {
		t.Fatalf("саммари проекта: код %d, %s", code, raw)
	}
	saved := decode[Project](t, raw)
	if saved.Summary == nil || saved.Summary.Stale {
		t.Fatalf("саммари проекта не сохранилось: %+v", saved.Summary)
	}

	// Правка сообщения в одной из сессий проекта — саммари устарело.
	_, raw = do(t, srv, "GET", "/api/sessions/"+first.ID, nil, "secret")
	payload := decode[struct {
		Messages []Message `json:"messages"`
	}](t, raw)
	msg := payload.Messages[0]
	do(t, srv, "PATCH", "/api/sessions/"+first.ID+"/messages/"+msg.ID,
		map[string]any{"content": "про акции и облигации"}, "secret")

	_, raw = do(t, srv, "GET", "/api/projects/"+project.ID, nil, "secret")
	project = decode[Project](t, raw)
	if project.Summary == nil || !project.Summary.Stale {
		t.Fatalf("ожидал устаревшее саммари проекта: %+v", project.Summary)
	}
	if project.MessageCount != 1 {
		t.Fatalf("ожидал 1 сообщение в проекте, получил %d", project.MessageCount)
	}
}

// Импорт локальной сессии с саммари: саммари сохраняется, ревизия пересчитана.
func TestImportKeepsSummary(t *testing.T) {
	srv := newTestServer(t)
	code, raw := do(t, srv, "POST", "/api/sessions/local_1/import", map[string]any{
		"session": map[string]any{
			"title":     "Локальная",
			"createdAt": 1700000000000,
			"summary":   map[string]any{"text": "кратко", "model": "ds-pro"},
		},
		"messages": []map[string]any{{"id": "m1", "role": "user", "content": "привет"}},
	}, "secret")
	if code != 200 {
		t.Fatalf("импорт: код %d, %s", code, raw)
	}
	session := decode[Session](t, raw)
	if session.Summary == nil || session.Summary.Text != "кратко" {
		t.Fatalf("саммари потерялось при импорте: %+v", session.Summary)
	}
	if session.Summary.Stale {
		t.Fatalf("при импорте ревизия должна совпасть: %+v", session.Summary)
	}
}
