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
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

const version = "1.0.0"

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

	store, err := NewStore(*dataDir)
	if err != nil {
		log.Fatalf("хранилище: %v", err)
	}
	api := &API{store: store, name: *name, started: time.Now()}

	mux := http.NewServeMux()
	api.routes(mux)

	handler := withLogging(withCORS(withAuth(mux, tok), *origins))

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

// withAuth пропускает только запросы с верным Bearer-токеном.
// /api/health открыт: по нему клиент проверяет адрес до ввода токена.
func withAuth(next http.Handler, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions || r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		if token == "" {
			next.ServeHTTP(w, r)
			return
		}
		given := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
		given = strings.TrimSpace(given)
		if subtle.ConstantTimeCompare([]byte(given), []byte(token)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="gena"`)
			writeError(w, http.StatusUnauthorized, "нужен токен доступа")
			return
		}
		next.ServeHTTP(w, r)
	})
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

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(sw, r)
		// В лог — только путь без query: там может быть что угодно.
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.code, time.Since(start).Round(time.Millisecond))
	})
}
