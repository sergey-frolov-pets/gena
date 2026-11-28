package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

// newAuthServer — сервер с мастер-токеном "secret" и реестром кодов доступа.
func newAuthServer(t *testing.T) (*httptest.Server, *AccessStore) {
	t.Helper()
	srv, access, _ := newAuthServerDir(t)
	return srv, access
}

// newAuthServerDir — то же плюс каталог данных: тесты читают файлы напрямую.
func newAuthServerDir(t *testing.T) (*httptest.Server, *AccessStore, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := NewStore(dir)
	if err != nil {
		t.Fatalf("хранилище: %v", err)
	}
	access, err := NewAccessStore(dir)
	if err != nil {
		t.Fatalf("коды доступа: %v", err)
	}
	api := &API{store: store, access: access, name: "test", started: time.Now(), token: "secret"}
	mux := routesFor(api)
	srv := httptest.NewServer(withAuth(mux, "secret", access))
	t.Cleanup(srv.Close)
	return srv, access, dir
}

// issueCode выпускает гостевой код от имени владельца.
func issueCode(t *testing.T, srv *httptest.Server, label string) (string, string) {
	t.Helper()
	status, raw := do(t, srv, "POST", "/api/access", map[string]any{"label": label}, "secret")
	if status != 201 {
		t.Fatalf("выпуск кода: %d %s", status, raw)
	}
	out := decode[struct {
		Code   string     `json:"code"`
		Access AccessView `json:"access"`
	}](t, raw)
	if out.Code == "" || out.Access.ID == "" {
		t.Fatalf("пустой код в ответе: %s", raw)
	}
	return out.Access.ID, out.Code
}

func createSessionAs(t *testing.T, srv *httptest.Server, token, continuation string) Session {
	t.Helper()
	body := map[string]any{"title": "Тест"}
	if continuation != "" {
		body["continuation"] = continuation
	}
	status, raw := do(t, srv, "POST", "/api/sessions", body, token)
	if status != 201 {
		t.Fatalf("создание сессии: %d %s", status, raw)
	}
	return decode[Session](t, raw)
}

func TestGuestSeesSessionsButCannotManageAccess(t *testing.T) {
	srv, _ := newAuthServer(t)
	_, guest := issueCode(t, srv, "Гость")

	status, _ := do(t, srv, "GET", "/api/sessions", nil, guest)
	if status != 200 {
		t.Fatalf("гость читает список: получил %d", status)
	}
	status, raw := do(t, srv, "GET", "/api/access", nil, guest)
	if status != 403 {
		t.Fatalf("гость не должен видеть коды: %d %s", status, raw)
	}
	status, _ = do(t, srv, "POST", "/api/access", map[string]any{"label": "сам себе"}, guest)
	if status != 403 {
		t.Fatalf("гость не должен выпускать коды: %d", status)
	}
}

func TestServerInfoReportsRole(t *testing.T) {
	srv, _ := newAuthServer(t)
	_, guest := issueCode(t, srv, "Гость")

	_, raw := do(t, srv, "GET", "/api/server", nil, "secret")
	owner := decode[map[string]any](t, raw)
	if owner["role"] != "owner" || owner["canManageAccess"] != true {
		t.Fatalf("владельцу ждали role=owner: %v", owner)
	}
	if owner["accessCodes"] != float64(1) {
		t.Fatalf("владелец должен видеть число кодов: %v", owner["accessCodes"])
	}

	_, raw = do(t, srv, "GET", "/api/server", nil, guest)
	guestInfo := decode[map[string]any](t, raw)
	if guestInfo["role"] != "guest" || guestInfo["canManageAccess"] != false {
		t.Fatalf("гостю ждали role=guest: %v", guestInfo)
	}
	if _, ok := guestInfo["accessCodes"]; ok {
		t.Fatalf("гостю не нужно знать число кодов: %v", guestInfo)
	}
}

func TestGuestCannotDeleteForeignSession(t *testing.T) {
	srv, _ := newAuthServer(t)
	_, alice := issueCode(t, srv, "Алиса")
	_, bob := issueCode(t, srv, "Боб")

	session := createSessionAs(t, srv, alice, "")

	status, _ := do(t, srv, "DELETE", "/api/sessions/"+session.ID, nil, bob)
	if status != 403 {
		t.Fatalf("чужую сессию удалять нельзя: получил %d", status)
	}
	status, raw := do(t, srv, "DELETE", "/api/sessions/"+session.ID, nil, alice)
	if status != 200 {
		t.Fatalf("инициатор должен удалять свою сессию: %d %s", status, raw)
	}
}

func TestContinuationViewBlocksGuestWrites(t *testing.T) {
	srv, _ := newAuthServer(t)
	_, alice := issueCode(t, srv, "Алиса")
	_, bob := issueCode(t, srv, "Боб")

	session := createSessionAs(t, srv, alice, ContinuationView)
	if session.Continuation != ContinuationView {
		t.Fatalf("режим не сохранился: %q", session.Continuation)
	}

	path := "/api/sessions/" + session.ID + "/messages"
	status, _ := do(t, srv, "POST", path, Message{Content: "я Боб"}, bob)
	if status != 403 {
		t.Fatalf("при режиме view гость не пишет: получил %d", status)
	}
	status, _ = do(t, srv, "POST", path, Message{Content: "я Алиса"}, alice)
	if status != 201 {
		t.Fatalf("инициатор пишет всегда: получил %d", status)
	}

	// Инициатор открывает продолжение — гость снова может писать.
	status, raw := do(t, srv, "PATCH", "/api/sessions/"+session.ID,
		map[string]any{"continuation": "all"}, alice)
	if status != 200 {
		t.Fatalf("смена режима инициатором: %d %s", status, raw)
	}
	status, _ = do(t, srv, "POST", path, Message{Content: "теперь можно"}, bob)
	if status != 201 {
		t.Fatalf("после all гость пишет: получил %d", status)
	}

	// Чужой гость режим не меняет.
	status, _ = do(t, srv, "PATCH", "/api/sessions/"+session.ID,
		map[string]any{"continuation": "view"}, bob)
	if status != 403 {
		t.Fatalf("режим меняет только инициатор: получил %d", status)
	}
}

func TestLegacySessionBelongsToOwner(t *testing.T) {
	srv, _ := newAuthServer(t)
	_, guest := issueCode(t, srv, "Гость")

	session := createSessionAs(t, srv, "secret", "")
	if session.OwnerID != "" {
		t.Fatalf("сессия владельца должна быть без ownerId: %q", session.OwnerID)
	}
	status, _ := do(t, srv, "DELETE", "/api/sessions/"+session.ID, nil, guest)
	if status != 403 {
		t.Fatalf("гость не удаляет сессию владельца: получил %d", status)
	}
	status, _ = do(t, srv, "PATCH", "/api/sessions/"+session.ID,
		map[string]any{"title": "переименовал"}, guest)
	if status != 403 {
		t.Fatalf("гость не переименовывает чужую сессию: получил %d", status)
	}
}

func TestBlockedCodeGets403AndDeleteRevokes(t *testing.T) {
	srv, _ := newAuthServer(t)
	id, code := issueCode(t, srv, "Проверка")

	status, _ := do(t, srv, "PATCH", "/api/access/"+id, map[string]any{"blocked": true}, "secret")
	if status != 200 {
		t.Fatalf("блокировка: %d", status)
	}
	status, raw := do(t, srv, "GET", "/api/sessions", nil, code)
	if status != 403 {
		t.Fatalf("заблокированный код: ждали 403, получил %d %s", status, raw)
	}

	status, _ = do(t, srv, "PATCH", "/api/access/"+id, map[string]any{"blocked": false}, "secret")
	if status != 200 {
		t.Fatalf("разблокировка: %d", status)
	}
	status, _ = do(t, srv, "GET", "/api/sessions", nil, code)
	if status != 200 {
		t.Fatalf("после разблокировки ждали 200, получил %d", status)
	}

	status, _ = do(t, srv, "DELETE", "/api/access/"+id, nil, "secret")
	if status != 200 {
		t.Fatalf("удаление кода: %d", status)
	}
	status, _ = do(t, srv, "GET", "/api/sessions", nil, code)
	if status != 401 {
		t.Fatalf("удалённый код: ждали 401, получил %d", status)
	}
}

func TestImportCannotStealOwnership(t *testing.T) {
	srv, _ := newAuthServer(t)
	_, alice := issueCode(t, srv, "Алиса")
	_, bob := issueCode(t, srv, "Боб")

	payload := map[string]any{
		"session":  map[string]any{"title": "Импорт"},
		"messages": []Message{{Role: "user", Content: "привет"}},
	}
	status, raw := do(t, srv, "POST", "/api/sessions/s_imported/import", payload, alice)
	if status != 200 {
		t.Fatalf("импорт нового диалога: %d %s", status, raw)
	}
	imported := decode[Session](t, raw)
	if imported.OwnerID == "" {
		t.Fatalf("импорт гостя должен записать инициатора")
	}

	status, _ = do(t, srv, "POST", "/api/sessions/s_imported/import", payload, bob)
	if status != 403 {
		t.Fatalf("гость не переписывает чужой импорт: получил %d", status)
	}
	status, _ = do(t, srv, "POST", "/api/sessions/s_imported/import", payload, alice)
	if status != 200 {
		t.Fatalf("инициатор может переписать свой импорт: получил %d", status)
	}
}

func TestMessageSizeLimit(t *testing.T) {
	srv, _ := newAuthServer(t)
	previous := maxMessageBytes
	maxMessageBytes = 1024
	t.Cleanup(func() { maxMessageBytes = previous })

	session := createSessionAs(t, srv, "secret", "")
	big := make([]byte, 2000)
	for i := range big {
		big[i] = 'a'
	}
	status, raw := do(t, srv, "POST", "/api/sessions/"+session.ID+"/messages",
		Message{Content: string(big)}, "secret")
	if status != 413 {
		t.Fatalf("большое сообщение: ждали 413, получил %d %s", status, raw)
	}
	_, raw = do(t, srv, "GET", "/api/sessions/"+session.ID, nil, "secret")
	got := decode[struct {
		Session Session `json:"session"`
	}](t, raw)
	if got.Session.Messages != 0 {
		t.Fatalf("отказ не должен добавлять сообщение: %d", got.Session.Messages)
	}
}

func TestSessionMessageCountLimit(t *testing.T) {
	srv, _ := newAuthServer(t)
	previous := maxMessagesPerSession
	maxMessagesPerSession = 2
	t.Cleanup(func() { maxMessagesPerSession = previous })

	session := createSessionAs(t, srv, "secret", "")
	path := "/api/sessions/" + session.ID + "/messages"
	for i := 0; i < 2; i++ {
		if status, raw := do(t, srv, "POST", path, Message{Content: "ок"}, "secret"); status != 201 {
			t.Fatalf("сообщение %d: %d %s", i+1, status, raw)
		}
	}
	status, raw := do(t, srv, "POST", path, Message{Content: "лишнее"}, "secret")
	if status != 409 {
		t.Fatalf("переполнение сессии: ждали 409, получил %d %s", status, raw)
	}
}

func TestSessionCountLimit(t *testing.T) {
	srv, _ := newAuthServer(t)
	previous := maxSessions
	maxSessions = 1
	t.Cleanup(func() { maxSessions = previous })

	createSessionAs(t, srv, "secret", "")
	status, raw := do(t, srv, "POST", "/api/sessions", map[string]any{"title": "вторая"}, "secret")
	if status != 507 {
		t.Fatalf("предел числа сессий: ждали 507, получил %d %s", status, raw)
	}
}
