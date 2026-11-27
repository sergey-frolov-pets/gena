package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newAgentsServer — сервер с файлом агентов; пустая строка → без файла.
func newAgentsServer(t *testing.T, agentsJSON string) *httptest.Server {
	t.Helper()
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("хранилище: %v", err)
	}
	path := ""
	if agentsJSON != "" {
		path = filepath.Join(t.TempDir(), "agents.json")
		if err := os.WriteFile(path, []byte(agentsJSON), 0o600); err != nil {
			t.Fatalf("файл агентов: %v", err)
		}
	}
	api := &API{
		store:   store,
		name:    "test",
		started: time.Now(),
		agents:  NewAgentRegistry(path),
		client:  &http.Client{},
	}
	mux := http.NewServeMux()
	api.routes(mux)
	srv := httptest.NewServer(withAuth(mux, "secret"))
	t.Cleanup(srv.Close)
	return srv
}

func TestAgentsListHidesKeys(t *testing.T) {
	srv := newAgentsServer(t, `{"agents":[
		{"id":"ds-chat","name":"DeepSeek Chat","baseUrl":"https://api.deepseek.com/v1","model":"deepseek-chat","apiKey":"sk-secret-value"},
		{"id":"broken","baseUrl":"","model":"x","apiKey":"k"}
	]}`)

	code, raw := do(t, srv, http.MethodGet, "/api/agents", nil, "secret")
	if code != http.StatusOK {
		t.Fatalf("код %d: %s", code, raw)
	}
	if strings.Contains(string(raw), "sk-secret-value") || strings.Contains(string(raw), "apiKey") {
		t.Fatalf("ключ утёк в ответ: %s", raw)
	}
	list := decode[[]map[string]any](t, raw)
	if len(list) != 1 {
		t.Fatalf("агентов %d, ждали 1 (битая запись отброшена): %s", len(list), raw)
	}
	if list[0]["id"] != "ds-chat" || list[0]["model"] != "deepseek-chat" {
		t.Fatalf("не тот агент: %v", list[0])
	}
	if list[0]["provider"] != "api.deepseek.com" {
		t.Fatalf("провайдер %v", list[0]["provider"])
	}
}

func TestAgentsListWithoutFile(t *testing.T) {
	srv := newAgentsServer(t, "")
	code, raw := do(t, srv, http.MethodGet, "/api/agents", nil, "secret")
	if code != http.StatusOK {
		t.Fatalf("код %d: %s", code, raw)
	}
	list := decode[[]map[string]any](t, raw)
	if len(list) != 0 {
		t.Fatalf("ждали пустой список: %s", raw)
	}
}

func TestChatUnknownAgent(t *testing.T) {
	srv := newAgentsServer(t, `{"agents":[{"id":"ds","baseUrl":"http://127.0.0.1:1/v1","model":"m","apiKey":"k"}]}`)
	code, _ := do(t, srv, http.MethodPost, "/api/agents/nope/chat", map[string]any{
		"messages": []map[string]string{{"role": "user", "content": "привет"}},
	}, "secret")
	if code != http.StatusNotFound {
		t.Fatalf("код %d, ждали 404", code)
	}
}

func TestChatEmptyHistory(t *testing.T) {
	srv := newAgentsServer(t, `{"agents":[{"id":"ds","baseUrl":"http://127.0.0.1:1/v1","model":"m","apiKey":"k"}]}`)
	code, _ := do(t, srv, http.MethodPost, "/api/agents/ds/chat", map[string]any{"messages": []any{}}, "secret")
	if code != http.StatusBadRequest {
		t.Fatalf("код %d, ждали 400", code)
	}
}

// Прокси: провайдер получает ключ и стрим, клиенту уходят те же куски.
func TestChatProxiesToProvider(t *testing.T) {
	var gotAuth, gotBody string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("путь %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"при\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"вет\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer provider.Close()

	srv := newAgentsServer(t, `{"agents":[{
		"id":"ds","name":"DeepSeek","baseUrl":"`+provider.URL+`/v1","model":"deepseek-chat",
		"apiKey":"sk-test","systemPrompt":"будь краток"
	}]}`)

	code, raw := do(t, srv, http.MethodPost, "/api/agents/ds/chat", map[string]any{
		"messages": []map[string]string{{"role": "user", "content": "привет"}},
		"stream":   true,
	}, "secret")
	if code != http.StatusOK {
		t.Fatalf("код %d: %s", code, raw)
	}
	text := string(raw)
	for _, want := range []string{"при", "вет", "[DONE]"} {
		if !strings.Contains(text, want) {
			t.Fatalf("в ответе нет %q: %s", want, text)
		}
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("провайдер получил %q", gotAuth)
	}
	if !strings.Contains(gotBody, "будь краток") || !strings.Contains(gotBody, "deepseek-chat") {
		t.Fatalf("тело запроса к провайдеру: %s", gotBody)
	}
	if strings.Contains(gotBody, "sk-test") {
		t.Fatalf("ключ попал в тело запроса")
	}
}

// Ошибку провайдера отдаём клиенту тем же кодом и текстом.
func TestChatProviderError(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer provider.Close()

	srv := newAgentsServer(t, `{"agents":[{"id":"ds","baseUrl":"`+provider.URL+`","model":"m","apiKey":"k"}]}`)
	code, raw := do(t, srv, http.MethodPost, "/api/agents/ds/chat", map[string]any{
		"messages": []map[string]string{{"role": "user", "content": "привет"}},
	}, "secret")
	if code != http.StatusUnauthorized {
		t.Fatalf("код %d: %s", code, raw)
	}
	var payload map[string]string
	if err := json.Unmarshal(raw, &payload); err != nil || !strings.Contains(payload["error"], "invalid api key") {
		t.Fatalf("тело ошибки: %s", raw)
	}
}

// Стрим не должен копиться в буфере: без Flush обёртка withLogging рвёт SSE.
func TestStatusWriterFlushes(t *testing.T) {
	rec := &flushRecorder{ResponseWriter: httptest.NewRecorder()}
	sw := &statusWriter{ResponseWriter: rec, code: http.StatusOK}
	flusher, ok := any(sw).(http.Flusher)
	if !ok {
		t.Fatal("statusWriter не реализует http.Flusher")
	}
	flusher.Flush()
	if !rec.flushed {
		t.Fatal("Flush не дошёл до исходного писателя")
	}
}

type flushRecorder struct {
	http.ResponseWriter
	flushed bool
}

func (f *flushRecorder) Flush() { f.flushed = true }
