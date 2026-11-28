package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// API — HTTP-слой: разбирает запросы и отдаёт JSON.
type API struct {
	store   *Store
	access  *AccessStore
	name    string
	started time.Time
	// client — HTTP-клиент для запросов к провайдерам (nil → http.Client{}).
	client *http.Client
	// accessUntil — до какого числа сервер доступен клиентам (нулевое — не задано).
	// Показывается в карточке «Подключения» и в /api/health; после этой даты
	// сервер закрыт (withAccessWindow), открыт остаётся только /api/health.
	accessUntil time.Time
	// accessText — та же дата в исходном виде: дату отдаём датой, без сдвига дня.
	accessText string
}

func (a *API) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/server", a.serverInfo)

	mux.HandleFunc("GET /api/sessions", a.listSessions)
	mux.HandleFunc("POST /api/sessions", a.createSession)
	mux.HandleFunc("GET /api/sessions/{id}", a.getSession)
	mux.HandleFunc("PATCH /api/sessions/{id}", a.patchSession)
	mux.HandleFunc("DELETE /api/sessions/{id}", a.deleteSession)
	mux.HandleFunc("GET /api/sessions/{id}/export.md", a.exportMarkdown)
	mux.HandleFunc("POST /api/sessions/{id}/messages", a.appendMessage)
	mux.HandleFunc("PATCH /api/sessions/{id}/messages/{msg}", a.patchMessage)
	mux.HandleFunc("DELETE /api/sessions/{id}/messages/{msg}", a.deleteMessage)
	mux.HandleFunc("POST /api/sessions/{id}/import", a.importSession)

	a.projectRoutes(mux)
	a.accessRoutes(mux)
}

func writeJSON(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]string{"error": message})
}

func (a *API) fail(w http.ResponseWriter, err error, action string) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "не найдено")
	case errors.Is(err, ErrAccessNotFound):
		writeError(w, http.StatusNotFound, "код доступа не найден")
	case errors.Is(err, ErrMessageTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("сообщение больше %d КБ — сократите текст или вложения", maxMessageBytes>>10))
	case errors.Is(err, ErrSessionTooLarge):
		writeError(w, http.StatusConflict, "сессия переполнена: начните новый диалог")
	case errors.Is(err, ErrServerFull):
		writeError(w, http.StatusInsufficientStorage, "на сервере закончилось место: удалите старые сессии")
	case errors.Is(err, ErrTooManyCodes):
		writeError(w, http.StatusConflict,
			fmt.Sprintf("достигнут предел %d кодов доступа", maxAccessCodes))
	default:
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("%s: %v", action, err))
	}
}

// forbidden — отказ по правам. Не раскрываем, чья сессия и почему:
// гость не должен узнавать лишнего о других участниках.
func forbidden(w http.ResponseWriter) {
	writeError(w, http.StatusForbidden, "нет прав на это действие в сессии")
}

// sessionFor читает заголовок сессии и проверяет права. Если false —
// ответ клиенту уже отправлен.
func (a *API) sessionFor(w http.ResponseWriter, r *http.Request, allowed func(Principal, Session) bool) (Session, bool) {
	session, err := a.store.Meta(r.PathValue("id"))
	if err != nil {
		a.fail(w, err, "не прочитал сессию")
		return Session{}, false
	}
	if !allowed(principalOf(r), session) {
		forbidden(w)
		return Session{}, false
	}
	return session, true
}

func roleOf(p Principal) string {
	if p.IsOwner() {
		return "owner"
	}
	return "guest"
}

func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "не разобрал JSON: "+err.Error())
		return false
	}
	return true
}

func (a *API) health(w http.ResponseWriter, _ *http.Request) {
	payload := map[string]any{
		"ok":       true,
		"name":     a.name,
		"version":  version,
		"time":     time.Now().UTC().Format(time.RFC3339),
		"sessions": a.store.Count(),
		"projects": a.store.CountProjects(),
	}
	// Срок доступа задаётся в конфиге сервера. Клиенту нужен тот же факт,
	// что видит админ: иначе дату пришлось бы дублировать на каждом устройстве.
	if !a.accessUntil.IsZero() {
		payload["accessUntil"] = a.accessText
		// Срок прошёл — клиент показывает плашку «доступ закрыт», а не «до …».
		payload["expired"] = accessClosed(a.accessUntil, time.Now())
	}
	writeJSON(w, http.StatusOK, payload)
}

func (a *API) serverInfo(w http.ResponseWriter, r *http.Request) {
	p := principalOf(r)
	payload := map[string]any{
		"name":            a.name,
		"version":         version,
		"sessions":        a.store.Count(),
		"projects":        a.store.CountProjects(),
		"startedAt":       a.started.UTC().Format(time.RFC3339),
		"time":            time.Now().UTC().Format(time.RFC3339),
		"role":            roleOf(p),
		"owner":           p.IsOwner(),
		"canManageAccess": p.IsOwner(),
		"accessId":        p.AccessID,
		"label":           p.Label,
	}
	// Число кодов — только владельцу: гостю эта цифра ничего не даёт.
	if p.IsOwner() {
		payload["accessCodes"] = a.access.Count()
	}
	writeJSON(w, http.StatusOK, payload)
}

func (a *API) listSessions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.store.List())
}

func (a *API) createSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title        string `json:"title"`
		AgentID      string `json:"agentId"`
		Continuation string `json:"continuation"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	p := principalOf(r)
	session, err := a.store.Create(body.Title, body.AgentID, p.AccessID, body.Continuation)
	if err != nil {
		a.fail(w, err, "не создал сессию")
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (a *API) getSession(w http.ResponseWriter, r *http.Request) {
	session, messages, err := a.store.Get(r.PathValue("id"))
	if err != nil {
		a.fail(w, err, "не прочитал сессию")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "messages": messages})
}

func (a *API) patchSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title        *string   `json:"title"`
		Pinned       *bool     `json:"pinned"`
		Tags         *[]string `json:"tags"`
		ProjectID    *string   `json:"projectId"`
		Continuation *string   `json:"continuation"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if _, ok := a.sessionFor(w, r, canManageSession); !ok {
		return
	}
	session, err := a.store.Patch(r.PathValue("id"), body.Title, body.Pinned, body.Tags, body.ProjectID, body.Continuation)
	if err != nil {
		a.fail(w, err, "не обновил сессию")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (a *API) deleteSession(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.sessionFor(w, r, canManageSession); !ok {
		return
	}
	if err := a.store.Delete(r.PathValue("id")); err != nil {
		a.fail(w, err, "не удалил сессию")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *API) appendMessage(w http.ResponseWriter, r *http.Request) {
	var message Message
	if !decodeBody(w, r, &message) {
		return
	}
	if strings.TrimSpace(message.Content) == "" && message.Kind == "" {
		writeError(w, http.StatusBadRequest, "пустое сообщение")
		return
	}
	if _, ok := a.sessionFor(w, r, canWriteSession); !ok {
		return
	}
	saved, err := a.store.Append(r.PathValue("id"), message)
	if err != nil {
		a.fail(w, err, "не добавил сообщение")
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *API) patchMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content string `json:"content"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if _, ok := a.sessionFor(w, r, canManageSession); !ok {
		return
	}
	message, err := a.store.PatchMessage(r.PathValue("id"), r.PathValue("msg"), body.Content)
	if err != nil {
		a.fail(w, err, "не обновил сообщение")
		return
	}
	writeJSON(w, http.StatusOK, message)
}

func (a *API) deleteMessage(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.sessionFor(w, r, canManageSession); !ok {
		return
	}
	if err := a.store.DeleteMessage(r.PathValue("id"), r.PathValue("msg")); err != nil {
		a.fail(w, err, "не удалил сообщение")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *API) importSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Session  Session   `json:"session"`
		Messages []Message `json:"messages"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	p := principalOf(r)
	id := r.PathValue("id")
	// Существующую сессию переписывает только владелец или инициатор:
	// иначе гость мог бы затереть чужой диалог.
	if existing, err := a.store.Meta(id); err == nil {
		if !canManageSession(p, existing) {
			forbidden(w)
			return
		}
	} else if !errors.Is(err, ErrNotFound) {
		a.fail(w, err, "не прочитал сессию")
		return
	}
	session, err := a.store.Import(id, body.Session, body.Messages, p.AccessID)
	if err != nil {
		a.fail(w, err, "не сохранил сессию")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

// exportMarkdown отдаёт диалог файлом: имя в Content-Disposition,
// чтобы браузер сразу предложил «Сохранить».
func (a *API) exportMarkdown(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	session, messages, err := a.store.Get(id)
	if err != nil {
		a.fail(w, err, "не прочитал сессию")
		return
	}
	name := fmt.Sprintf("gena-%s.md", safeFileName(session.Title))
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(sessionMarkdown(session, messages)))
}

// safeFileName: в заголовке допустим только ASCII без кавычек,
// кириллица уходит в транслит, иначе браузер покажет «%D0%94...».
func safeFileName(title string) string {
	translit := map[rune]string{
		'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "e",
		'ж': "zh", 'з': "z", 'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m",
		'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u",
		'ф': "f", 'х': "h", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "sch", 'ъ': "",
		'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",
	}
	var b strings.Builder
	for _, r := range strings.ToLower(title) {
		if mapped, ok := translit[r]; ok {
			b.WriteString(mapped)
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			continue
		}
		if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
			b.WriteString("-")
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "session"
	}
	if len(out) > 48 {
		out = out[:48]
	}
	return out
}
