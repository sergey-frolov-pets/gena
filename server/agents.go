package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// AgentSpec — серверный агент: адрес провайдера, модель и ключ живут только
// на сервере. Клиент видит id, имя и модель, но не ключ.
type AgentSpec struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	BaseURL      string   `json:"baseUrl"`
	Model        string   `json:"model"`
	APIKey       string   `json:"apiKey"`
	SystemPrompt string   `json:"systemPrompt,omitempty"`
	Temperature  *float64 `json:"temperature,omitempty"`
	MaxTokens    int      `json:"maxTokens,omitempty"`
}

type agentsFile struct {
	Agents []AgentSpec `json:"agents"`
}

// AgentRegistry — список агентов из JSON-файла. Файл читается на каждый
// запрос: правка состава не требует рестарта службы.
type AgentRegistry struct {
	path string
}

func NewAgentRegistry(path string) *AgentRegistry {
	return &AgentRegistry{path: strings.TrimSpace(path)}
}

// List возвращает годные записи: без id, baseUrl или модели агент
// бесполезен, поэтому такие строки пропускаем (а не роняем весь файл).
func (r *AgentRegistry) List() []AgentSpec {
	if r == nil || r.path == "" {
		return nil
	}
	raw, err := os.ReadFile(r.path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("агенты: не прочитал %s: %v", r.path, err)
		}
		return nil
	}
	var file agentsFile
	if err := json.Unmarshal(raw, &file); err != nil {
		log.Printf("агенты: файл %s не разобрался: %v", r.path, err)
		return nil
	}
	out := make([]AgentSpec, 0, len(file.Agents))
	for _, spec := range file.Agents {
		spec.ID = strings.TrimSpace(spec.ID)
		spec.BaseURL = strings.TrimSpace(spec.BaseURL)
		spec.Model = strings.TrimSpace(spec.Model)
		if spec.ID == "" || spec.BaseURL == "" || spec.Model == "" {
			continue
		}
		out = append(out, spec)
	}
	return out
}

func (r *AgentRegistry) Get(id string) (AgentSpec, bool) {
	for _, spec := range r.List() {
		if spec.ID == id {
			return spec, true
		}
	}
	return AgentSpec{}, false
}

func (r *AgentRegistry) Count() int {
	return len(r.List())
}

// agentView — то, что уходит клиенту: ключа здесь нет и быть не должно.
type agentView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Model    string `json:"model"`
	Provider string `json:"provider,omitempty"`
}

func (a *API) listAgents(w http.ResponseWriter, _ *http.Request) {
	specs := a.agents.List()
	out := make([]agentView, 0, len(specs))
	for _, spec := range specs {
		name := spec.Name
		if strings.TrimSpace(name) == "" {
			name = spec.ID
		}
		out = append(out, agentView{
			ID:       spec.ID,
			Name:     name,
			Model:    spec.Model,
			Provider: hostOf(spec.BaseURL),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func hostOf(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Host
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// chatWithAgent — прокси до провайдера. Запрос уходит с сервера: телефон
// больше не ходит к api.deepseek.com напрямую, ключ остаётся на сервере.
func (a *API) chatWithAgent(w http.ResponseWriter, r *http.Request) {
	spec, ok := a.agents.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "агент не найден")
		return
	}

	var body struct {
		Messages    []chatMessage `json:"messages"`
		Stream      *bool         `json:"stream"`
		Temperature *float64      `json:"temperature"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Messages) == 0 {
		writeError(w, http.StatusBadRequest, "пустая история")
		return
	}

	messages := make([]chatMessage, 0, len(body.Messages)+1)
	if prompt := strings.TrimSpace(spec.SystemPrompt); prompt != "" {
		messages = append(messages, chatMessage{Role: "system", Content: prompt})
	}
	for _, msg := range body.Messages {
		role := strings.TrimSpace(msg.Role)
		if role == "" {
			role = "user"
		}
		messages = append(messages, chatMessage{Role: role, Content: msg.Content})
	}

	stream := body.Stream == nil || *body.Stream
	payload := map[string]any{
		"model":    spec.Model,
		"messages": messages,
		"stream":   stream,
	}
	if stream {
		payload["stream_options"] = map[string]any{"include_usage": true}
	}
	temperature := spec.Temperature
	if body.Temperature != nil {
		temperature = body.Temperature
	}
	if temperature != nil {
		payload["temperature"] = *temperature
	}
	if spec.MaxTokens > 0 {
		payload["max_tokens"] = spec.MaxTokens
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "не собрал запрос")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	endpoint := strings.TrimRight(spec.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "не собрал запрос: "+err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+spec.APIKey)
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	}

	client := a.client
	if client == nil {
		client = &http.Client{}
	}

	started := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "провайдер недоступен: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		text := strings.TrimSpace(string(detail))
		if text == "" {
			text = http.StatusText(resp.StatusCode)
		}
		writeError(w, resp.StatusCode, text)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	// Отдаём куски по мере прихода: без Flush SSE копится в буфере и весь
	// выигрыш от стрима пропадает.
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 16<<10)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			break
		}
	}

	log.Printf("агент %s: модель %s, %s", spec.ID, spec.Model, time.Since(started).Round(time.Millisecond))
}
