package main

import (
	"net/http"
)

// Проекты и саммари — отдельный файл, чтобы api.go оставался про сессии.

func (a *API) projectRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/projects", a.listProjects)
	mux.HandleFunc("POST /api/projects", a.createProject)
	mux.HandleFunc("GET /api/projects/{id}", a.getProject)
	mux.HandleFunc("PATCH /api/projects/{id}", a.patchProject)
	mux.HandleFunc("DELETE /api/projects/{id}", a.deleteProject)
	mux.HandleFunc("POST /api/projects/{id}/summary", a.setProjectSummary)
	mux.HandleFunc("DELETE /api/projects/{id}/summary", a.deleteProjectSummary)

	mux.HandleFunc("POST /api/sessions/{id}/summary", a.setSessionSummary)
	mux.HandleFunc("DELETE /api/sessions/{id}/summary", a.deleteSessionSummary)
}

func (a *API) listProjects(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.store.ListProjects())
}

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string   `json:"name"`
		Sessions []string `json:"sessionIds"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	project, err := a.store.CreateProject(body.Name, body.Sessions)
	if err != nil {
		a.fail(w, err, "не создал проект")
		return
	}
	writeJSON(w, http.StatusCreated, project)
}

func (a *API) getProject(w http.ResponseWriter, r *http.Request) {
	project, err := a.store.GetProject(r.PathValue("id"))
	if err != nil {
		a.fail(w, err, "не прочитал проект")
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (a *API) patchProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     *string   `json:"name"`
		Sessions *[]string `json:"sessionIds"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	project, err := a.store.PatchProject(r.PathValue("id"), body.Name, body.Sessions)
	if err != nil {
		a.fail(w, err, "не обновил проект")
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (a *API) deleteProject(w http.ResponseWriter, r *http.Request) {
	if err := a.store.DeleteProject(r.PathValue("id")); err != nil {
		a.fail(w, err, "не удалил проект")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// setSessionSummary принимает готовый текст: саммари считает клиент
// выбранным агентом, сервер только хранит и следит за ревизией.
func (a *API) setSessionSummary(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text  string `json:"text"`
		Model string `json:"model"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	session, err := a.store.SetSessionSummary(r.PathValue("id"), body.Text, body.Model)
	if err != nil {
		a.fail(w, err, "не сохранил саммари")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (a *API) deleteSessionSummary(w http.ResponseWriter, r *http.Request) {
	session, err := a.store.DeleteSessionSummary(r.PathValue("id"))
	if err != nil {
		a.fail(w, err, "не удалил саммари")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (a *API) setProjectSummary(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text  string `json:"text"`
		Model string `json:"model"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	project, err := a.store.SetProjectSummary(r.PathValue("id"), body.Text, body.Model)
	if err != nil {
		a.fail(w, err, "не сохранил саммари проекта")
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (a *API) deleteProjectSummary(w http.ResponseWriter, r *http.Request) {
	project, err := a.store.DeleteProjectSummary(r.PathValue("id"))
	if err != nil {
		a.fail(w, err, "не удалил саммари проекта")
		return
	}
	writeJSON(w, http.StatusOK, project)
}
