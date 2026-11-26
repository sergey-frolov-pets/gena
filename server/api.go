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
	name    string
	started time.Time
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
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "не найдено")
		return
	}
	writeError(w, http.StatusInternalServerError, fmt.Sprintf("%s: %v", action, err))
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
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"name":     a.name,
		"version":  version,
		"time":     time.Now().UTC().Format(time.RFC3339),
		"sessions": a.store.Count(),
		"projects": a.store.CountProjects(),
	})
}

func (a *API) serverInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":      a.name,
		"version":   version,
		"sessions":  a.store.Count(),
		"projects":  a.store.CountProjects(),
		"startedAt": a.started.UTC().Format(time.RFC3339),
		"time":      time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *API) listSessions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.store.List())
}

func (a *API) createSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title   string `json:"title"`
		AgentID string `json:"agentId"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	session, err := a.store.Create(body.Title, body.AgentID)
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
		Title     *string   `json:"title"`
		Pinned    *bool     `json:"pinned"`
		Tags      *[]string `json:"tags"`
		ProjectID *string   `json:"projectId"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	session, err := a.store.Patch(r.PathValue("id"), body.Title, body.Pinned, body.Tags, body.ProjectID)
	if err != nil {
		a.fail(w, err, "не обновил сессию")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (a *API) deleteSession(w http.ResponseWriter, r *http.Request) {
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
	message, err := a.store.PatchMessage(r.PathValue("id"), r.PathValue("msg"), body.Content)
	if err != nil {
		a.fail(w, err, "не обновил сообщение")
		return
	}
	writeJSON(w, http.StatusOK, message)
}

func (a *API) deleteMessage(w http.ResponseWriter, r *http.Request) {
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
	session, err := a.store.Import(r.PathValue("id"), body.Session, body.Messages)
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
