package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("хранилище: %v", err)
	}
	api := &API{store: store, name: "test", started: time.Now()}
	mux := http.NewServeMux()
	api.routes(mux)
	srv := httptest.NewServer(withAuth(mux, "secret"))
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, srv *httptest.Server, method, path string, body any, token string) (int, []byte) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, srv.URL+path, reader)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	return resp.StatusCode, buf.Bytes()
}

func decode[T any](t *testing.T, raw []byte) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	return out
}

func TestHealthIsOpen(t *testing.T) {
	srv := newTestServer(t)
	code, raw := do(t, srv, http.MethodGet, "/api/health", nil, "")
	if code != http.StatusOK {
		t.Fatalf("health: код %d", code)
	}
	if !strings.Contains(string(raw), `"ok":true`) {
		t.Fatalf("health: %s", raw)
	}
}

func TestSessionsRequireToken(t *testing.T) {
	srv := newTestServer(t)
	if code, _ := do(t, srv, http.MethodGet, "/api/sessions", nil, ""); code != http.StatusUnauthorized {
		t.Fatalf("без токена: код %d", code)
	}
	if code, _ := do(t, srv, http.MethodGet, "/api/sessions", nil, "wrong"); code != http.StatusUnauthorized {
		t.Fatalf("неверный токен: код %d", code)
	}
	if code, _ := do(t, srv, http.MethodGet, "/api/sessions", nil, "secret"); code != http.StatusOK {
		t.Fatalf("с токеном: код %d", code)
	}
}

func TestSessionLifecycle(t *testing.T) {
	srv := newTestServer(t)

	code, raw := do(t, srv, http.MethodPost, "/api/sessions", map[string]string{"title": "Вклады", "agentId": "agent_1"}, "secret")
	if code != http.StatusCreated {
		t.Fatalf("создание: код %d %s", code, raw)
	}
	session := decode[Session](t, raw)
	if session.ID == "" || session.Title != "Вклады" {
		t.Fatalf("создание: %+v", session)
	}

	for _, text := range []string{"привет", "ответ"} {
		role := "user"
		if text == "ответ" {
			role = "assistant"
		}
		code, raw = do(t, srv, http.MethodPost, "/api/sessions/"+session.ID+"/messages",
			map[string]any{"role": role, "content": text}, "secret")
		if code != http.StatusCreated {
			t.Fatalf("сообщение: код %d %s", code, raw)
		}
	}

	code, raw = do(t, srv, http.MethodGet, "/api/sessions/"+session.ID, nil, "secret")
	if code != http.StatusOK {
		t.Fatalf("чтение: код %d", code)
	}
	got := decode[struct {
		Session  Session   `json:"session"`
		Messages []Message `json:"messages"`
	}](t, raw)
	if len(got.Messages) != 2 || got.Session.Messages != 2 {
		t.Fatalf("сообщений: %d / %d", len(got.Messages), got.Session.Messages)
	}

	title := "Вклады и ставки"
	pinned := true
	code, _ = do(t, srv, http.MethodPatch, "/api/sessions/"+session.ID, map[string]any{"title": title, "pinned": pinned}, "secret")
	if code != http.StatusOK {
		t.Fatalf("правка: код %d", code)
	}

	code, md := do(t, srv, http.MethodGet, "/api/sessions/"+session.ID+"/export.md", nil, "secret")
	if code != http.StatusOK {
		t.Fatalf("экспорт: код %d", code)
	}
	text := string(md)
	for _, want := range []string{"# Вклады и ставки", "**Вы**", "**Агент**", "привет", "ответ"} {
		if !strings.Contains(text, want) {
			t.Fatalf("в markdown нет %q:\n%s", want, text)
		}
	}

	code, raw = do(t, srv, http.MethodGet, "/api/sessions", nil, "secret")
	if code != http.StatusOK {
		t.Fatalf("список: код %d", code)
	}
	list := decode[[]Session](t, raw)
	if len(list) != 1 || !list[0].Pinned {
		t.Fatalf("список: %+v", list)
	}

	if code, _ := do(t, srv, http.MethodDelete, "/api/sessions/"+session.ID, nil, "secret"); code != http.StatusOK {
		t.Fatalf("удаление: код %d", code)
	}
	if code, _ := do(t, srv, http.MethodGet, "/api/sessions/"+session.ID, nil, "secret"); code != http.StatusNotFound {
		t.Fatalf("после удаления: код %d", code)
	}
}

func TestImportReplacesMessages(t *testing.T) {
	srv := newTestServer(t)
	code, raw := do(t, srv, http.MethodPost, "/api/sessions", map[string]string{"title": "Импорт"}, "secret")
	if code != http.StatusCreated {
		t.Fatalf("создание: код %d", code)
	}
	session := decode[Session](t, raw)

	body := map[string]any{
		"session": map[string]any{"title": "Синхронизировано", "agentId": "a1"},
		"messages": []map[string]any{
			{"role": "user", "content": "первое", "createdAt": 1000},
			{"role": "assistant", "content": "второе", "createdAt": 2000, "model": "ds-pro"},
		},
	}
	if code, raw := do(t, srv, http.MethodPost, "/api/sessions/"+session.ID+"/import", body, "secret"); code != http.StatusOK {
		t.Fatalf("импорт: код %d %s", code, raw)
	}
	_, raw = do(t, srv, http.MethodGet, "/api/sessions/"+session.ID, nil, "secret")
	got := decode[struct {
		Session  Session   `json:"session"`
		Messages []Message `json:"messages"`
	}](t, raw)
	if got.Session.Title != "Синхронизировано" || len(got.Messages) != 2 {
		t.Fatalf("после импорта: %+v / %d", got.Session, len(got.Messages))
	}
	if got.Messages[0].Content != "первое" || got.Messages[1].Model != "ds-pro" {
		t.Fatalf("порядок или модель: %+v", got.Messages)
	}
}

func TestNewSessionNeedsNoBodyTitle(t *testing.T) {
	srv := newTestServer(t)
	code, raw := do(t, srv, http.MethodPost, "/api/sessions", map[string]string{}, "secret")
	if code != http.StatusCreated {
		t.Fatalf("код %d", code)
	}
	session := decode[Session](t, raw)
	if session.Title != "Новый диалог" {
		t.Fatalf("заголовок: %q", session.Title)
	}
}

func TestSafeFileName(t *testing.T) {
	cases := map[string]string{
		"Вклады и ставки": "vklady-i-stavki",
		"   ":             "session",
		"Q1 report":       "q1-report",
	}
	for in, want := range cases {
		if got := safeFileName(in); got != want {
			t.Fatalf("safeFileName(%q) = %q, ждал %q", in, got, want)
		}
	}
	if name := safeFileName(strings.Repeat("я", 100)); len(name) > 48 {
		t.Fatalf("длина имени: %d", len(name))
	}
}

func TestStorePersistsBetweenRestarts(t *testing.T) {
	dir := t.TempDir()
	store, err := NewStore(dir)
	if err != nil {
		t.Fatalf("хранилище: %v", err)
	}
	session, err := store.Create("Проверка", "")
	if err != nil {
		t.Fatalf("создание: %v", err)
	}
	if _, err := store.Append(session.ID, Message{Role: "user", Content: "текст"}); err != nil {
		t.Fatalf("сообщение: %v", err)
	}

	again, err := NewStore(dir)
	if err != nil {
		t.Fatalf("перезапуск: %v", err)
	}
	got, messages, err := again.Get(session.ID)
	if err != nil {
		t.Fatalf("чтение: %v", err)
	}
	if got.Title != "Проверка" || len(messages) != 1 || messages[0].Content != "текст" {
		t.Fatalf("после перезапуска: %+v / %+v", got, messages)
	}
}

func TestCleanTagsLimitsAndDedupes(t *testing.T) {
	tags := cleanTags([]string{" работа ", "Работа", "", "вклады", "очень-длинный-тег-который-надо-обрезать"})
	if len(tags) != 3 {
		t.Fatalf("теги: %v", tags)
	}
	if len([]rune(tags[2])) != 32 {
		t.Fatalf("длина тега: %d", len([]rune(tags[2])))
	}
}

func TestErrorsAreJSON(t *testing.T) {
	srv := newTestServer(t)
	code, raw := do(t, srv, http.MethodGet, "/api/sessions/nope", nil, "secret")
	if code != http.StatusNotFound {
		t.Fatalf("код %d", code)
	}
	var payload map[string]string
	if err := json.Unmarshal(raw, &payload); err != nil || payload["error"] == "" {
		t.Fatalf("ответ: %s", raw)
	}
}

func TestMarkdownKeepsThoughts(t *testing.T) {
	session := Session{ID: "s1", Title: "Тест", CreatedAt: 1}
	messages := []Message{
		{Role: "user", Content: "вопрос", CreatedAt: 2},
		{Role: "assistant", Kind: "thought", Content: "думаю", CreatedAt: 3},
		{Role: "assistant", Kind: "tool_calls", Content: `{"name":"x"}`, CreatedAt: 4},
	}
	text := sessionMarkdown(session, messages)
	for _, want := range []string{"💭", "🛠", "```json", "вопрос"} {
		if !strings.Contains(text, want) {
			t.Fatalf("нет %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "CreatedAt") {
		t.Fatalf("в текст попали поля: %s", text)
	}
	_ = fmt.Sprintf("%v", messages)
}
