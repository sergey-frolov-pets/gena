package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// ErrNotFound — сессии или сообщения нет.
var ErrNotFound = errors.New("не найдено")

// Session — диалог на сервере. Поля совпадают с клиентской моделью Gena,
// поэтому список отдаётся в интерфейс без переименований.
type Session struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	AgentID   string   `json:"agentId,omitempty"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
	Pinned    bool     `json:"pinned,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	TokenMode bool     `json:"tokenMode,omitempty"`
	// ProjectID — проект, в который входит диалог (пусто — без проекта).
	ProjectID string `json:"projectId,omitempty"`
	// OwnerID — код доступа инициатора сессии. Пусто — сессия владельца
	// сервера (так читаются и все сессии, созданные до 0.2.105).
	OwnerID string `json:"ownerId,omitempty"`
	// Continuation — можно ли гостям продолжать диалог: "all" или "view".
	// Пусто трактуется как "all" (прежнее поведение).
	Continuation string `json:"continuation,omitempty"`
	// Summary — сжатое содержание диалога; Stale считается при отдаче.
	Summary *Summary `json:"summary,omitempty"`
	// Messages — число сообщений, считается при отдаче (в файле его нет).
	Messages int `json:"messageCount"`
}

// Режим продолжения сессии: "all" — любой гость может писать,
// "view" — только просмотр (пишет владелец и инициатор).
const (
	ContinuationAll  = "all"
	ContinuationView = "view"
)

// normalizeContinuation приводит значение к двум допустимым: всё, что
// не "view", считается "all" — так старые сессии ведут себя как раньше.
func normalizeContinuation(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), ContinuationView) {
		return ContinuationView
	}
	return ContinuationAll
}

// Message — сообщение диалога.
type Message struct {
	ID          string          `json:"id"`
	SessionID   string          `json:"sessionId"`
	Role        string          `json:"role"`
	Content     string          `json:"content"`
	CreatedAt   int64           `json:"createdAt"`
	Kind        string          `json:"kind,omitempty"`
	Model       string          `json:"model,omitempty"`
	ResponderID string          `json:"responderId,omitempty"`
	ServerID    string          `json:"serverId,omitempty"`
	EditedAt    int64           `json:"editedAt,omitempty"`
	Usage       json.RawMessage `json:"usage,omitempty"`
	Attachments json.RawMessage `json:"attachments,omitempty"`
}

type sessionFile struct {
	Session  Session   `json:"session"`
	Messages []Message `json:"messages"`
	// size — вес сессии для лимитов; в файл не пишется, считается при
	// загрузке и обновляется инкрементально.
	size int64
}

// Store — все диалоги в памяти + файл на каждый диалог.
// Один файл на сессию: правка не переписывает остальные,
// а повреждённый файл теряет только свой диалог.
type Store struct {
	dir      string
	mu       sync.RWMutex
	sessions map[string]*sessionFile
	projects map[string]*Project
	// totalSize — сумма размеров всех сессий, для лимита maxServerBytes.
	totalSize int64
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "sessions"), 0o700); err != nil {
		return nil, err
	}
	s := &Store{
		dir:      dir,
		sessions: map[string]*sessionFile{},
		projects: map[string]*Project{},
	}
	entries, err := os.ReadDir(s.dirSessions())
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.dirSessions(), entry.Name()))
		if err != nil {
			return nil, err
		}
		var file sessionFile
		if err := json.Unmarshal(raw, &file); err != nil {
			log.Printf("пропускаю битый файл %s: %v", entry.Name(), err)
			continue
		}
		if file.Session.ID == "" {
			continue
		}
		file.size = sessionBytes(&file)
		s.totalSize += file.size
		s.sessions[file.Session.ID] = &file
	}
	if err := s.loadProjects(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) dirSessions() string { return filepath.Join(s.dir, "sessions") }

// List отдаёт копии сессий: закреплённые сверху, дальше по времени правки.
func (s *Store) List() []Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Session, 0, len(s.sessions))
	for _, file := range s.sessions {
		out = append(out, buildSession(file))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out
}

// buildSession отдаёт копию сессии с посчитанными полями: число сообщений
// и признак устаревшего саммари.
func buildSession(file *sessionFile) Session {
	session := file.Session
	session.Messages = len(file.Messages)
	session.Continuation = normalizeContinuation(session.Continuation)
	if session.Summary != nil {
		summary := *session.Summary
		summary.Stale = summary.Revision != revisionOf(file.Messages)
		session.Summary = &summary
	}
	return session
}

// Get отдаёт сессию вместе с сообщениями (копии, чтобы не портить кэш).
func (s *Store) Get(id string) (Session, []Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	file, ok := s.sessions[id]
	if !ok {
		return Session{}, nil, ErrNotFound
	}
	messages := make([]Message, len(file.Messages))
	copy(messages, file.Messages)
	return buildSession(file), messages, nil
}

// Meta отдаёт только заголовок сессии — для проверки прав без копирования
// всех сообщений.
func (s *Store) Meta(id string) (Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	file, ok := s.sessions[id]
	if !ok {
		return Session{}, ErrNotFound
	}
	return buildSession(file), nil
}

func (s *Store) Create(title, agentID, ownerID, continuation, projectID string) (Session, error) {
	projectID = strings.TrimSpace(projectID)
	now := time.Now().UnixMilli()
	session := Session{
		ID:           newID("s"),
		Title:        cleanTitle(title),
		AgentID:      strings.TrimSpace(agentID),
		CreatedAt:    now,
		UpdatedAt:    now,
		OwnerID:      ownerID,
		Continuation: normalizeContinuation(continuation),
		ProjectID:    projectID,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Несуществующий проект — ошибка: иначе сессия молча окажется вне проекта.
	if projectID != "" {
		if _, ok := s.projects[projectID]; !ok {
			return Session{}, ErrNotFound
		}
	}
	if len(s.sessions) >= maxSessions {
		return Session{}, ErrServerFull
	}
	file := &sessionFile{Session: session}
	file.size = sessionBytes(file)
	if s.totalSize+file.size > maxServerBytes {
		return Session{}, ErrServerFull
	}
	s.sessions[session.ID] = file
	s.totalSize += file.size
	if err := s.save(session.ID); err != nil {
		delete(s.sessions, session.ID)
		s.totalSize -= file.size
		return Session{}, err
	}
	return buildSession(file), nil
}

// Patch меняет метаданные сессии. nil-поля не трогаются.
func (s *Store) Patch(id string, title *string, pinned *bool, tags *[]string, projectID *string, continuation *string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[id]
	if !ok {
		return Session{}, ErrNotFound
	}
	previous := *file
	oldSize := file.size
	if title != nil {
		file.Session.Title = cleanTitle(*title)
	}
	if pinned != nil {
		file.Session.Pinned = *pinned
	}
	if tags != nil {
		file.Session.Tags = cleanTags(*tags)
	}
	if projectID != nil {
		value := strings.TrimSpace(*projectID)
		if value != "" {
			if _, ok := s.projects[value]; !ok {
				return Session{}, ErrNotFound
			}
		}
		file.Session.ProjectID = value
	}
	if continuation != nil {
		file.Session.Continuation = normalizeContinuation(*continuation)
	}
	file.Session.UpdatedAt = time.Now().UnixMilli()
	file.size = sessionBytes(file)
	if file.size > maxSessionBytes {
		*file = previous
		return Session{}, ErrSessionTooLarge
	}
	if s.totalSize-oldSize+file.size > maxServerBytes {
		*file = previous
		return Session{}, ErrServerFull
	}
	if err := s.save(id); err != nil {
		*file = previous
		return Session{}, err
	}
	s.totalSize += file.size - oldSize
	return buildSession(file), nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[id]
	if !ok {
		return ErrNotFound
	}
	delete(s.sessions, id)
	s.totalSize -= file.size
	if err := os.Remove(s.file(id)); err != nil && !os.IsNotExist(err) {
		s.sessions[id] = file
		s.totalSize += file.size
		return err
	}
	return nil
}

// Append добавляет сообщение. Пустой id сообщения заменяется серверным.
func (s *Store) Append(sessionID string, message Message) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[sessionID]
	if !ok {
		return Message{}, ErrNotFound
	}
	if message.Role == "" {
		message.Role = "user"
	}
	if message.CreatedAt == 0 {
		message.CreatedAt = time.Now().UnixMilli()
	}
	if strings.TrimSpace(message.ID) == "" {
		message.ID = newID("m")
	}
	message.SessionID = sessionID
	if err := checkMessageSize(message); err != nil {
		return Message{}, err
	}
	if len(file.Messages)+1 > maxMessagesPerSession {
		return Message{}, ErrSessionTooLarge
	}
	delta := messageBytes(message)
	if file.size+delta > maxSessionBytes {
		return Message{}, ErrSessionTooLarge
	}
	if s.totalSize+delta > maxServerBytes {
		return Message{}, ErrServerFull
	}
	file.Messages = append(file.Messages, message)
	if message.CreatedAt > file.Session.UpdatedAt {
		file.Session.UpdatedAt = message.CreatedAt
	} else {
		file.Session.UpdatedAt = time.Now().UnixMilli()
	}
	if err := s.save(sessionID); err != nil {
		file.Messages = file.Messages[:len(file.Messages)-1]
		return Message{}, err
	}
	file.size += delta
	s.totalSize += delta
	return message, nil
}

func (s *Store) PatchMessage(sessionID, messageID, content string) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[sessionID]
	if !ok {
		return Message{}, ErrNotFound
	}
	for i := range file.Messages {
		if file.Messages[i].ID != messageID {
			continue
		}
		updated := file.Messages[i]
		updated.Content = content
		if err := checkMessageSize(updated); err != nil {
			return Message{}, err
		}
		delta := messageBytes(updated) - messageBytes(file.Messages[i])
		if file.size+delta > maxSessionBytes {
			return Message{}, ErrSessionTooLarge
		}
		if s.totalSize+delta > maxServerBytes {
			return Message{}, ErrServerFull
		}
		updated.EditedAt = time.Now().UnixMilli()
		file.Messages[i] = updated
		file.Session.UpdatedAt = updated.EditedAt
		if err := s.save(sessionID); err != nil {
			return Message{}, err
		}
		file.size += delta
		s.totalSize += delta
		return updated, nil
	}
	return Message{}, ErrNotFound
}

func (s *Store) DeleteMessage(sessionID, messageID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, ok := s.sessions[sessionID]
	if !ok {
		return ErrNotFound
	}
	for i := range file.Messages {
		if file.Messages[i].ID != messageID {
			continue
		}
		removed := file.Messages[i]
		removedSize := messageBytes(removed)
		file.Messages = append(file.Messages[:i], file.Messages[i+1:]...)
		file.Session.UpdatedAt = time.Now().UnixMilli()
		if err := s.save(sessionID); err != nil {
			// Откат в памяти: файл не записался, значит и список не меняем.
			file.Messages = append(file.Messages[:i], append([]Message{removed}, file.Messages[i:]...)...)
			return err
		}
		file.size -= removedSize
		s.totalSize -= removedSize
		return nil
	}
	return ErrNotFound
}

// Import заменяет сессию и сообщения целиком — так клиент синхронизирует
// локальный диалог с сервером. ownerID задаёт инициатора только при создании
// новой сессии: подменить владельца через import нельзя.
func (s *Store) Import(sessionID string, session Session, messages []Message, ownerID string) (Session, error) {
	// Лимиты проверяем до любых изменений в памяти: либо импорт целиком,
	// либо ничего.
	if len(messages) > maxMessagesPerSession {
		return Session{}, ErrSessionTooLarge
	}
	for _, message := range messages {
		if err := checkMessageSize(message); err != nil {
			return Session{}, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UnixMilli()
	file, exists := s.sessions[sessionID]
	if !exists {
		if len(s.sessions) >= maxSessions {
			return Session{}, ErrServerFull
		}
		file = &sessionFile{Session: Session{
			ID:           sessionID,
			CreatedAt:    now,
			OwnerID:      ownerID,
			Continuation: normalizeContinuation(session.Continuation),
		}}
	}
	previous := *file
	oldSize := file.size
	if file.Session.CreatedAt == 0 {
		file.Session.CreatedAt = session.CreatedAt
	}
	if file.Session.CreatedAt == 0 {
		file.Session.CreatedAt = now
	}
	if title := strings.TrimSpace(session.Title); title != "" {
		file.Session.Title = cleanTitle(title)
	}
	if session.AgentID != "" {
		file.Session.AgentID = session.AgentID
	}
	file.Session.Pinned = session.Pinned
	file.Session.Tags = cleanTags(session.Tags)
	file.Session.TokenMode = session.TokenMode
	if session.ProjectID != "" {
		if _, ok := s.projects[session.ProjectID]; ok {
			file.Session.ProjectID = session.ProjectID
		}
	}
	// Саммари приходит с клиента вместе с диалогом: ревизию считаем по факту,
	// присланный флаг Stale игнорируем.
	if session.Summary != nil && strings.TrimSpace(session.Summary.Text) != "" {
		file.Session.Summary = &Summary{
			Text:       strings.TrimSpace(session.Summary.Text),
			Model:      strings.TrimSpace(session.Summary.Model),
			UpdatedAt:  session.Summary.UpdatedAt,
			Characters: len([]rune(session.Summary.Text)),
		}
		if file.Session.Summary.UpdatedAt == 0 {
			file.Session.Summary.UpdatedAt = now
		}
	}

	clean := make([]Message, 0, len(messages))
	for _, message := range messages {
		if message.Role == "" {
			message.Role = "user"
		}
		if strings.TrimSpace(message.ID) == "" {
			message.ID = newID("m")
		}
		message.SessionID = sessionID
		if message.CreatedAt == 0 {
			message.CreatedAt = now
		}
		clean = append(clean, message)
	}
	sort.SliceStable(clean, func(i, j int) bool { return clean[i].CreatedAt < clean[j].CreatedAt })
	file.Messages = clean
	if file.Session.Summary != nil && strings.TrimSpace(file.Session.Summary.Text) != "" {
		file.Session.Summary.Revision = revisionOf(clean)
	}
	file.Session.UpdatedAt = now
	file.size = sessionBytes(file)
	if file.size > maxSessionBytes {
		*file = previous
		return Session{}, ErrSessionTooLarge
	}
	if s.totalSize-oldSize+file.size > maxServerBytes {
		*file = previous
		return Session{}, ErrServerFull
	}
	// Новая сессия попадает в карту до записи: save ищет файл по карте.
	s.sessions[sessionID] = file
	if err := s.save(sessionID); err != nil {
		*file = previous
		if !exists {
			delete(s.sessions, sessionID)
		}
		return Session{}, err
	}
	s.totalSize += file.size - oldSize
	return buildSession(file), nil
}

func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions)
}

// save пишет файл атомарно: временный + rename. Читатель никогда не увидит
// половину JSON.
func (s *Store) save(id string) error {
	file, ok := s.sessions[id]
	if !ok {
		return ErrNotFound
	}
	raw, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	target := s.file(id)
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("запись %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, target); err != nil {
		return fmt.Errorf("переименование %s: %w", target, err)
	}
	return nil
}

func (s *Store) file(id string) string {
	return filepath.Join(s.dirSessions(), id+".json")
}

func newID(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano())
	}
	return prefix + "_" + hex.EncodeToString(buf)
}

func cleanTitle(title string) string {
	title = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(title, "\r", " "), "\n", " "))
	if title == "" {
		return "Новый диалог"
	}
	if runes := []rune(title); len(runes) > 200 {
		return string(runes[:200])
	}
	return title
}

func cleanTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[strings.ToLower(tag)] {
			continue
		}
		if runes := []rune(tag); len(runes) > 32 {
			tag = string(runes[:32])
		}
		seen[strings.ToLower(tag)] = true
		out = append(out, tag)
		if len(out) >= 12 {
			break
		}
	}
	return out
}
