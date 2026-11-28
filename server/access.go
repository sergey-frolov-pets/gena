package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Коды доступа: владелец выпускает код, гость ходит с ним как с Bearer.
// В файле лежит только SHA-256 кода — сам код показывается один раз
// при выпуске и больше нигде не хранится.

const (
	// accessFile — реестр кодов рядом с сессиями.
	accessFile = "access.json"
	// accessPrefix — чтобы код узнавался в логах и не путался с мастер-токеном.
	accessPrefix = "gac_"
	// accessCodeBytes — 24 случайных байта (48 hex-символов).
	accessCodeBytes = 24
	// accessTouch — как часто обновлять «последний визит» на диске.
	accessTouch = 5 * time.Minute
)

var (
	ErrAccessNotFound = errors.New("код доступа не найден")
	ErrAccessBlocked  = errors.New("код доступа заблокирован")
	ErrAccessExpired  = errors.New("срок действия кода истёк")
	ErrTooManyCodes   = errors.New("достигнут предел числа кодов доступа")
)

// Access — запись кода доступа. Hash — sha256 от кода в hex.
type Access struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Hash       string `json:"hash"`
	CreatedAt  int64  `json:"createdAt"`
	ExpiresAt  int64  `json:"expiresAt,omitempty"`
	Blocked    bool   `json:"blocked,omitempty"`
	LastSeenAt int64  `json:"lastSeenAt,omitempty"`
	// Projects — проекты, к которым ограничен гость. Пусто — весь сервер.
	Projects []string `json:"projects,omitempty"`
}

// AccessView — запись для владельца: без хеша и с признаком просрочки.
type AccessView struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	CreatedAt  int64  `json:"createdAt"`
	ExpiresAt  int64  `json:"expiresAt,omitempty"`
	Blocked    bool   `json:"blocked,omitempty"`
	LastSeenAt int64  `json:"lastSeenAt,omitempty"`
	Expired    bool   `json:"expired,omitempty"`
	// Projects — проекты, к которым ограничен гость. Пусто — весь сервер.
	Projects []string `json:"projects,omitempty"`
}

func (a *Access) view(now time.Time) AccessView {
	return AccessView{
		ID:         a.ID,
		Label:      a.Label,
		CreatedAt:  a.CreatedAt,
		ExpiresAt:  a.ExpiresAt,
		Blocked:    a.Blocked,
		LastSeenAt: a.LastSeenAt,
		Expired:    a.ExpiresAt > 0 && now.UnixMilli() > a.ExpiresAt,
		Projects:   append([]string(nil), a.Projects...),
	}
}

// AccessStore — реестр кодов в памяти и в access.json.
type AccessStore struct {
	path  string
	mu    sync.RWMutex
	items map[string]*Access
}

// NewAccessStore читает реестр из каталога данных. Файла нет — реестр пуст.
func NewAccessStore(dir string) (*AccessStore, error) {
	store := &AccessStore{
		path:  filepath.Join(dir, accessFile),
		items: map[string]*Access{},
	}
	raw, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("реестр кодов: %w", err)
	}
	var list []*Access
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("реестр кодов %s: %w", store.path, err)
	}
	for _, item := range list {
		if item == nil || strings.TrimSpace(item.ID) == "" || item.Hash == "" {
			continue
		}
		store.items[item.ID] = item
	}
	return store, nil
}

// List отдаёт коды владельцу (без хешей), свежие сверху.
func (s *AccessStore) List() []AccessView {
	s.mu.RLock()
	defer s.mu.RUnlock()
	now := time.Now()
	out := make([]AccessView, 0, len(s.items))
	for _, item := range s.items {
		out = append(out, item.view(now))
	}
	// Сортировка вставками: кодов максимум 50.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].CreatedAt > out[j-1].CreatedAt; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// Create выпускает новый код. Возвращает запись и сам код — единственный раз.
func (s *AccessStore) Create(label string, expiresAt int64, projects []string) (AccessView, string, error) {
	buf := make([]byte, accessCodeBytes)
	if _, err := rand.Read(buf); err != nil {
		return AccessView{}, "", fmt.Errorf("код доступа: %w", err)
	}
	code := accessPrefix + hex.EncodeToString(buf)

	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) >= maxAccessCodes {
		return AccessView{}, "", ErrTooManyCodes
	}
	now := time.Now()
	item := &Access{
		ID:        newID("a"),
		Label:     cleanAccessLabel(label),
		Hash:      hashAccessCode(code),
		CreatedAt: now.UnixMilli(),
		ExpiresAt: expiresAt,
		Projects:  normalizeAccessProjects(projects),
	}
	s.items[item.ID] = item
	if err := s.save(); err != nil {
		delete(s.items, item.ID)
		return AccessView{}, "", err
	}
	return item.view(now), code, nil
}

// Update меняет метку, блокировку, срок и область проектов.
// nil-поля не трогаются; пустой список проектов снимает ограничение.
func (s *AccessStore) Update(id string, label *string, blocked *bool, expiresAt *int64, projects *[]string) (AccessView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return AccessView{}, ErrAccessNotFound
	}
	previous := *item
	if label != nil {
		item.Label = cleanAccessLabel(*label)
	}
	if blocked != nil {
		item.Blocked = *blocked
	}
	if expiresAt != nil {
		item.ExpiresAt = *expiresAt
	}
	if projects != nil {
		item.Projects = normalizeAccessProjects(*projects)
	}
	if err := s.save(); err != nil {
		*item = previous
		return AccessView{}, err
	}
	return item.view(time.Now()), nil
}

// Delete убирает код: следующий запрос гостя получит 401.
func (s *AccessStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return ErrAccessNotFound
	}
	delete(s.items, id)
	if err := s.save(); err != nil {
		s.items[id] = item
		return err
	}
	return nil
}

// Lookup ищет код по значению Bearer. Сравнение — constant time,
// чтобы по времени ответа нельзя было подбирать код побайтово.
func (s *AccessStore) Lookup(code string) (*Access, error) {
	if !strings.HasPrefix(code, accessPrefix) {
		return nil, ErrAccessNotFound
	}
	sum := sha256.Sum256([]byte(code))
	hash := hex.EncodeToString(sum[:])

	s.mu.RLock()
	var found *Access
	for _, item := range s.items {
		if subtle.ConstantTimeCompare([]byte(item.Hash), []byte(hash)) == 1 {
			found = item
			break
		}
	}
	s.mu.RUnlock()
	if found == nil {
		return nil, ErrAccessNotFound
	}
	now := time.Now()
	if found.Blocked {
		return nil, ErrAccessBlocked
	}
	if found.ExpiresAt > 0 && now.UnixMilli() > found.ExpiresAt {
		return nil, ErrAccessExpired
	}

	// Отметку визита пишем на диск редко: иначе каждый запрос гостя
	// переписывает файл.
	s.mu.Lock()
	shouldSave := now.UnixMilli()-found.LastSeenAt > accessTouch.Milliseconds()
	if shouldSave {
		found.LastSeenAt = now.UnixMilli()
		if err := s.save(); err != nil {
			// Не мешаем работе: визит — не критичные данные.
			log.Printf("код доступа: отметка визита не сохранилась: %v", err)
		}
	}
	copied := *found
	s.mu.Unlock()
	return &copied, nil
}

// Count — сколько кодов выпущено.
func (s *AccessStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.items)
}

// save пишет реестр атомарно, права 0600.
func (s *AccessStore) save() error {
	list := make([]*Access, 0, len(s.items))
	for _, item := range s.items {
		list = append(list, item)
	}
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("запись %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("переименование %s: %w", s.path, err)
	}
	return nil
}

func hashAccessCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func cleanAccessLabel(label string) string {
	label = strings.TrimSpace(strings.ReplaceAll(label, "\n", " "))
	if label == "" {
		return "Гость"
	}
	if runes := []rune(label); len(runes) > 64 {
		return string(runes[:64])
	}
	return label
}

// normalizeAccessProjects чистит список проектов кода доступа: пробелы,
// дубли и слишком длинные id отбрасываем. Пустой результат — «весь сервер».
func normalizeAccessProjects(ids []string) []string {
	out := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || len(id) > 64 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) >= maxScopeProjects {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// Principal — кто пришёл: владелец сервера или гость с кодом.
type Principal struct {
	Owner    bool
	AccessID string
	Label    string
	// Projects — проекты, к которым ограничен гость. Пусто — весь сервер.
	Projects []string
}

// IsOwner — мастер-токен (или сервер без авторизации).
func (p Principal) IsOwner() bool { return p.Owner }

// SeesAllProjects — владелец или гость без ограничения по проектам.
func (p Principal) SeesAllProjects() bool { return p.IsOwner() || len(p.Projects) == 0 }

// CanSeeProject — виден ли проект в области доступа. Сессии без проекта
// ограниченному гостю не видны: иначе ограничение обходится новым чатом
// в корне. Владельцу и гостю без ограничения видно всё.
func (p Principal) CanSeeProject(projectID string) bool {
	if p.SeesAllProjects() {
		return true
	}
	if projectID == "" {
		return false
	}
	for _, id := range p.Projects {
		if id == projectID {
			return true
		}
	}
	return false
}

// canSeeSession — попал ли диалог в область доступа гостя.
func canSeeSession(p Principal, s Session) bool { return p.CanSeeProject(s.ProjectID) }

type principalKey struct{}

func withPrincipal(r *http.Request, p Principal) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), principalKey{}, p))
}

// principalOf достаёт принципала из контекста. Нет его — значит запрос
// прошёл мимо withAuth (health), прав хватать не должно.
func principalOf(r *http.Request) Principal {
	if p, ok := r.Context().Value(principalKey{}).(Principal); ok {
		return p
	}
	return Principal{}
}

// Права на сессию.
//
// Владелец сервера — всегда всё. Инициатор (создатель сессии) — правит
// метаданные, режим продолжения и удаляет сессию. Гость — читает всегда,
// пишет сообщения только если инициатор разрешил продолжение.
func canManageSession(p Principal, s Session) bool {
	if p.IsOwner() {
		return true
	}
	return p.AccessID != "" && s.OwnerID == p.AccessID
}

func canWriteSession(p Principal, s Session) bool {
	if canManageSession(p, s) {
		return true
	}
	return normalizeContinuation(s.Continuation) == ContinuationAll
}
