// Gena server — серверная часть Gena: хранит диалоги и отдаёт их по HTTP.
//
// Запуск:
//
//	gena-server -addr :8787 -data /var/lib/gena-server -token-file /etc/gena-server/token
//
// Без токена сервер не стартует: данные личные, открытый порт без пароля
// равносилен публикации переписки.
package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

const version = "1.1.0"

// parseAccessUntil разбирает срок доступа из конфига.
// Принимает дату `2026-12-31` (доступ до конца этого дня, UTC) и полный RFC3339.
// Второе значение — то, что покажем клиенту: дату оставляем датой, чтобы
// у пользователя не съезжал день из-за часового пояса.
func parseAccessUntil(value string) (time.Time, string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, "", nil
	}
	if day, err := time.Parse("2006-01-02", value); err == nil {
		return day.Add(24*time.Hour - time.Second), value, nil
	}
	at, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("ожидаю 2026-12-31 или RFC3339, получил %q", value)
	}
	return at, at.UTC().Format(time.RFC3339), nil
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func main() {
	addr := flag.String("addr", envOr("GENA_ADDR", ":8787"), "адрес HTTP-сервера")
	dataDir := flag.String("data", envOr("GENA_DATA", "/var/lib/gena-server"), "каталог данных")
	token := flag.String("token", os.Getenv("GENA_TOKEN"), "токен доступа (или GENA_TOKEN)")
	tokenFile := flag.String("token-file", os.Getenv("GENA_TOKEN_FILE"), "файл с токеном (или GENA_TOKEN_FILE)")
	origins := flag.String("cors", envOr("GENA_CORS", "*"), "разрешённые Origin через запятую; * — любые")
	name := flag.String("name", envOr("GENA_NAME", "Gena server"), "имя сервера в интерфейсе")
	accessUntil := flag.String("access-until", envOr("GENA_ACCESS_UNTIL", ""), "доступ до даты: 2026-12-31 (или GENA_ACCESS_UNTIL)")
	noAuth := flag.Bool("no-auth", false, "работать без токена (только для локальной отладки)")
	flag.Parse()

	tok := strings.TrimSpace(*token)
	if tok == "" {
		if path := strings.TrimSpace(*tokenFile); path != "" {
			raw, err := os.ReadFile(path)
			if err != nil {
				log.Fatalf("токен: %v", err)
			}
			tok = strings.TrimSpace(string(raw))
		}
	}
	if tok == "" && !*noAuth {
		log.Fatal("не задан токен: -token, GENA_TOKEN или -token-file (для отладки -no-auth)")
	}

	until, untilText, err := parseAccessUntil(*accessUntil)
	if err != nil {
		log.Fatalf("срок доступа: %v", err)
	}
	if *noAuth {
		// Локальная отладка без токена: окно доступа не мешает работе.
		until, untilText = time.Time{}, ""
	}

	store, err := NewStore(*dataDir)
	if err != nil {
		log.Fatalf("хранилище: %v", err)
	}
	access, err := NewAccessStore(*dataDir)
	if err != nil {
		log.Fatalf("коды доступа: %v", err)
	}
	api := &API{
		store:       store,
		access:      access,
		name:        *name,
		started:     time.Now(),
		client:      &http.Client{},
		accessUntil: until,
		accessText:  untilText,
	}

	mux := http.NewServeMux()
	api.routes(mux)

	// Окно доступа ставим внутрь CORS: preflight отвечает 204 ещё до проверки
	// срока, иначе браузер покажет ошибку CORS вместо понятного 403.
	handler := withLogging(withCORS(withAccessWindow(withAuth(mux, tok, access), until), *origins))

	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	stopped := make(chan error, 1)
	go func() {
		log.Printf("gena-server %s: слушаю %s, данные %s, сессий %d", version, *addr, *dataDir, len(store.List()))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			stopped <- err
		}
		close(stopped)
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-stopped:
		if err != nil {
			log.Fatalf("сервер: %v", err)
		}
	case s := <-sig:
		log.Printf("остановка: %s", s)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("остановка с ошибкой: %v", err)
		}
	}
}

// accessClosed: срок доступа задан и уже прошёл. Нулевая дата — сервер без срока.
func accessClosed(until, now time.Time) bool {
	return !until.IsZero() && now.After(until)
}

// withAccessWindow закрывает сервер после даты из -access-until: всё, кроме
// /api/health (по нему клиент проверяет адрес и видит дату), отвечает 403.
// Токен при этом верный — перевыпускать нечего, поэтому 403, а не 401.
func withAccessWindow(next http.Handler, until time.Time) http.Handler {
	if until.IsZero() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" || !accessClosed(until, time.Now()) {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusForbidden, "доступ закрыт: срок истёк "+until.UTC().Format("2006-01-02"))
	})
}

// withAuth пропускает только запросы с верным Bearer. Мастер-токен —
// владелец сервера, гостевой код доступа — роль гостя. /api/health открыт:
// по нему клиент проверяет адрес до ввода токена.
func withAuth(next http.Handler, token string, stores ...*AccessStore) http.Handler {
	var access *AccessStore
	if len(stores) > 0 {
		access = stores[0]
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions || r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		if token == "" {
			next.ServeHTTP(w, withPrincipal(r, Principal{Owner: true, Label: "владелец"}))
			return
		}
		given := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
		given = strings.TrimSpace(given)
		if given == "" {
			unauthorized(w, "нужен токен доступа")
			return
		}
		if subtle.ConstantTimeCompare([]byte(given), []byte(token)) == 1 {
			next.ServeHTTP(w, withPrincipal(r, Principal{Owner: true, Label: "владелец"}))
			return
		}
		if access != nil {
			item, err := access.Lookup(given)
			switch {
			case err == nil:
				next.ServeHTTP(w, withPrincipal(r, Principal{AccessID: item.ID, Label: item.Label}))
				return
			case errors.Is(err, ErrAccessBlocked), errors.Is(err, ErrAccessExpired):
				// Код верный, но доступ закрыт: 403, а не 401 — токен
				// перевыпускать не нужно, нужен доступ.
				writeError(w, http.StatusForbidden, err.Error())
				return
			}
		}
		unauthorized(w, "нужен токен доступа")
	})
}

func unauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="gena"`)
	writeError(w, http.StatusUnauthorized, message)
}

// withCORS: SPA живёт на другом домене, поэтому браузер спрашивает разрешение.
func withCORS(next http.Handler, origins string) http.Handler {
	allowed := map[string]bool{}
	any := false
	for _, item := range strings.Split(origins, ",") {
		item = strings.TrimSpace(item)
		if item == "*" {
			any = true
		} else if item != "" {
			allowed[item] = true
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (any || allowed[origin]) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

// Flush отдаёт накопленное в сеть: обёртка стоит вокруг обработчиков,
// и без этого метода стрим (SSE) копится в буфере целиком.
func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap — для http.ResponseController: он достаёт исходный писатель.
func (s *statusWriter) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(sw, r)
		// В лог — только путь без query: там может быть что угодно.
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.code, time.Since(start).Round(time.Millisecond))
	})
}
