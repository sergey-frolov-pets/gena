package main

import (
	"net/http"
	"time"
)

// Доступы: выпуск, список, блокировка и удаление кодов. Всё — только
// владельцу сервера: мастер-токен.

func (a *API) accessRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/access", a.listAccess)
	mux.HandleFunc("POST /api/access", a.createAccess)
	mux.HandleFunc("PATCH /api/access/{id}", a.patchAccess)
	mux.HandleFunc("DELETE /api/access/{id}", a.deleteAccess)
}

// requireOwner пропускает только владельца; ответ гостю уже отправлен.
func (a *API) requireOwner(w http.ResponseWriter, r *http.Request) bool {
	if principalOf(r).IsOwner() {
		return true
	}
	writeError(w, http.StatusForbidden, "управлять доступами может только владелец сервера")
	return false
}

func (a *API) listAccess(w http.ResponseWriter, r *http.Request) {
	if !a.requireOwner(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": a.access.List(),
		"max":   maxAccessCodes,
	})
}

func (a *API) createAccess(w http.ResponseWriter, r *http.Request) {
	if !a.requireOwner(w, r) {
		return
	}
	var body struct {
		Label     string `json:"label"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ExpiresAt > 0 && body.ExpiresAt <= time.Now().UnixMilli() {
		writeError(w, http.StatusBadRequest, "срок действия уже прошёл")
		return
	}
	item, code, err := a.access.Create(body.Label, body.ExpiresAt)
	if err != nil {
		a.fail(w, err, "не выпустил код доступа")
		return
	}
	// Единственный раз, когда код виден целиком. Дальше — только хеш
	// в файле, восстановить код нельзя.
	writeJSON(w, http.StatusCreated, map[string]any{
		"access": item,
		"code":   code,
	})
}

func (a *API) patchAccess(w http.ResponseWriter, r *http.Request) {
	if !a.requireOwner(w, r) {
		return
	}
	var body struct {
		Label     *string `json:"label"`
		Blocked   *bool   `json:"blocked"`
		ExpiresAt *int64  `json:"expiresAt"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ExpiresAt != nil && *body.ExpiresAt > 0 && *body.ExpiresAt <= time.Now().UnixMilli() {
		writeError(w, http.StatusBadRequest, "срок действия уже прошёл: чтобы закрыть доступ, заблокируйте код")
		return
	}
	item, err := a.access.Update(r.PathValue("id"), body.Label, body.Blocked, body.ExpiresAt)
	if err != nil {
		a.fail(w, err, "не обновил код доступа")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) deleteAccess(w http.ResponseWriter, r *http.Request) {
	if !a.requireOwner(w, r) {
		return
	}
	if err := a.access.Delete(r.PathValue("id")); err != nil {
		a.fail(w, err, "не удалил код доступа")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
