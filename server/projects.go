package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Summary — сжатое содержание сессии или проекта.
//
// Саммари считает клиент выбранным агентом (у сервера нет ключей моделей),
// сервер хранит текст и ревизию исходника. Ревизия меняется, когда в сессии
// появляется, правится или удаляется сообщение; при чтении сервер сам считает
// флаг Stale, чтобы интерфейс не решал это по датам.
type Summary struct {
	Text       string `json:"text"`
	Model      string `json:"model,omitempty"`
	UpdatedAt  int64  `json:"updatedAt"`
	Revision   string `json:"revision,omitempty"`
	Stale      bool   `json:"stale,omitempty"`
	Characters int    `json:"characters,omitempty"`
}

// Project — группа сессий с общим саммари.
type Project struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
	Sessions  []string `json:"sessionIds,omitempty"`
	Summary   *Summary `json:"summary,omitempty"`
	// MessageCount — сумма сообщений по существующим сессиям, считается при отдаче.
	MessageCount int `json:"messageCount"`
}

func (s *Store) dirProjects() string { return filepath.Join(s.dir, "projects") }

func (s *Store) projectFile(id string) string {
	return filepath.Join(s.dirProjects(), id+".json")
}

// loadProjects читает каталог проектов при старте: битый файл теряет только проект.
func (s *Store) loadProjects() error {
	if err := os.MkdirAll(s.dirProjects(), 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(s.dirProjects())
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.dirProjects(), entry.Name()))
		if err != nil {
			return err
		}
		var project Project
		if err := json.Unmarshal(raw, &project); err != nil {
			logSkip(entry.Name(), err)
			continue
		}
		if project.ID == "" {
			continue
		}
		s.projects[project.ID] = &project
	}
	return nil
}

// revisionOf — отпечаток содержимого диалога. Учитывает id, правку и длину
// текста: переименование сессии или смена тегов саммари не обесценивает.
func revisionOf(messages []Message) string {
	hash := sha256.New()
	for _, message := range messages {
		fmt.Fprintf(hash, "%s|%d|%d|%d\n", message.ID, message.EditedAt, message.CreatedAt, len(message.Content))
	}
	return hex.EncodeToString(hash.Sum(nil))[:16]
}

func (s *Store) projectRevisionLocked(project *Project) string {
	hash := sha256.New()
	ids := append([]string(nil), project.Sessions...)
	sort.Strings(ids)
	for _, id := range ids {
		file, ok := s.sessions[id]
		if !ok {
			continue
		}
		fmt.Fprintf(hash, "%s:%s\n", id, revisionOf(file.Messages))
	}
	return hex.EncodeToString(hash.Sum(nil))[:16]
}

func (s *Store) buildProjectLocked(project *Project) Project {
	out := *project
	if project.Sessions != nil {
		out.Sessions = append([]string(nil), project.Sessions...)
	}
	out.MessageCount = 0
	for _, id := range out.Sessions {
		if file, ok := s.sessions[id]; ok {
			out.MessageCount += len(file.Messages)
		}
	}
	if project.Summary != nil {
		summary := *project.Summary
		summary.Stale = summary.Revision != s.projectRevisionLocked(project)
		out.Summary = &summary
	}
	return out
}

// ListProjects — новые сверху.
func (s *Store) ListProjects() []Project {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Project, 0, len(s.projects))
	for _, project := range s.projects {
		out = append(out, s.buildProjectLocked(project))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (s *Store) GetProject(id string) (Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	project, ok := s.projects[id]
	if !ok {
		return Project{}, ErrNotFound
	}
	return s.buildProjectLocked(project), nil
}

func (s *Store) CreateProject(name string, sessionIDs []string) (Project, error) {
	now := time.Now().UnixMilli()
	project := Project{
		ID:        newID("p"),
		Name:      cleanProjectName(name),
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	project.Sessions = s.cleanSessionIDsLocked(sessionIDs)
	s.projects[project.ID] = &project
	if err := s.saveProject(project.ID); err != nil {
		delete(s.projects, project.ID)
		return Project{}, err
	}
	return s.buildProjectLocked(&project), nil
}

// PatchProject меняет имя и состав. nil-поля не трогаются.
func (s *Store) PatchProject(id string, name *string, sessionIDs *[]string) (Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	project, ok := s.projects[id]
	if !ok {
		return Project{}, ErrNotFound
	}
	previous := append([]string(nil), project.Sessions...)
	if name != nil {
		project.Name = cleanProjectName(*name)
	}
	if sessionIDs != nil {
		project.Sessions = s.cleanSessionIDsLocked(*sessionIDs)
	}
	project.UpdatedAt = time.Now().UnixMilli()
	if err := s.saveProject(id); err != nil {
		project.Sessions = previous
		return Project{}, err
	}
	return s.buildProjectLocked(project), nil
}

func (s *Store) DeleteProject(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.projects[id]; !ok {
		return ErrNotFound
	}
	delete(s.projects, id)
	for _, file := range s.sessions {
		if file.Session.ProjectID != id {
			continue
		}
		file.Session.ProjectID = ""
		_ = s.save(file.Session.ID)
	}
	if err := os.Remove(s.projectFile(id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// SetSessionSummary сохраняет саммари и подтягивает projectId сессии.
func (s *Store) SetSessionSummary(sessionID, text, model string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[sessionID]
	if !ok {
		return Session{}, ErrNotFound
	}
	if strings.TrimSpace(text) == "" {
		return Session{}, errors.New("пустое саммари")
	}
	file.Session.Summary = &Summary{
		Text:       strings.TrimSpace(text),
		Model:      strings.TrimSpace(model),
		UpdatedAt:  time.Now().UnixMilli(),
		Revision:   revisionOf(file.Messages),
		Characters: len([]rune(text)),
	}
	if err := s.save(sessionID); err != nil {
		file.Session.Summary = nil
		return Session{}, err
	}
	return buildSession(file), nil
}

func (s *Store) DeleteSessionSummary(sessionID string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[sessionID]
	if !ok {
		return Session{}, ErrNotFound
	}
	file.Session.Summary = nil
	if err := s.save(sessionID); err != nil {
		return Session{}, err
	}
	return buildSession(file), nil
}

func (s *Store) SetProjectSummary(projectID, text, model string) (Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	project, ok := s.projects[projectID]
	if !ok {
		return Project{}, ErrNotFound
	}
	if strings.TrimSpace(text) == "" {
		return Project{}, errors.New("пустое саммари")
	}
	project.Summary = &Summary{
		Text:       strings.TrimSpace(text),
		Model:      strings.TrimSpace(model),
		UpdatedAt:  time.Now().UnixMilli(),
		Revision:   s.projectRevisionLocked(project),
		Characters: len([]rune(text)),
	}
	if err := s.saveProject(projectID); err != nil {
		project.Summary = nil
		return Project{}, err
	}
	return s.buildProjectLocked(project), nil
}

func (s *Store) DeleteProjectSummary(projectID string) (Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	project, ok := s.projects[projectID]
	if !ok {
		return Project{}, ErrNotFound
	}
	project.Summary = nil
	if err := s.saveProject(projectID); err != nil {
		return Project{}, err
	}
	return s.buildProjectLocked(project), nil
}

// AddToProject прикрепляет сессию к проекту (projectID пустой — открепляет).
func (s *Store) AddToProject(sessionID, projectID string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[sessionID]
	if !ok {
		return Session{}, ErrNotFound
	}
	previous := file.Session.ProjectID
	file.Session.ProjectID = strings.TrimSpace(projectID)
	if file.Session.ProjectID != "" {
		project, ok := s.projects[file.Session.ProjectID]
		if !ok {
			file.Session.ProjectID = previous
			return Session{}, ErrNotFound
		}
		exists := false
		for _, id := range project.Sessions {
			if id == sessionID {
				exists = true
				break
			}
		}
		if !exists {
			project.Sessions = append(project.Sessions, sessionID)
			project.UpdatedAt = time.Now().UnixMilli()
			if err := s.saveProject(project.ID); err != nil {
				project.Sessions = project.Sessions[:len(project.Sessions)-1]
				file.Session.ProjectID = previous
				return Session{}, err
			}
		}
	}
	if err := s.save(sessionID); err != nil {
		file.Session.ProjectID = previous
		return Session{}, err
	}
	return buildSession(file), nil
}

func (s *Store) CountProjects() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.projects)
}

func (s *Store) saveProject(id string) error {
	project, ok := s.projects[id]
	if !ok {
		return ErrNotFound
	}
	raw, err := json.MarshalIndent(project, "", "  ")
	if err != nil {
		return err
	}
	target := s.projectFile(id)
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("запись %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, target); err != nil {
		return fmt.Errorf("переименование %s: %w", target, err)
	}
	return nil
}

// cleanSessionIDsLocked убирает повторы и несуществующие сессии, чтобы
// в проекте не висели ссылки на удалённое.
func (s *Store) cleanSessionIDsLocked(ids []string) []string {
	out := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if _, ok := s.sessions[id]; !ok {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func cleanProjectName(name string) string {
	name = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(name, "\r", " "), "\n", " "))
	if name == "" {
		return "Проект"
	}
	if runes := []rune(name); len(runes) > 120 {
		return string(runes[:120])
	}
	return name
}

func logSkip(name string, err error) {
	// Общий лог с store.go: битый файл не должен останавливать сервер.
	fmt.Fprintf(os.Stderr, "пропускаю битый файл %s: %v\n", name, err)
}
