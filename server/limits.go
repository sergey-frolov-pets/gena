package main

import "errors"

// Лимиты против раздувания памяти и диска. Значения — переменные, чтобы
// тесты могли подставить маленькие и не ждать 5000 сообщений.
//
// Правило: сверх лимита — отказ с понятным текстом. Данные никогда не
// режутся молча и не теряются.
var (
	// maxMessageBytes — одно сообщение вместе с вложениями и usage.
	maxMessageBytes int64 = 256 << 10 // 256 КБ
	// maxMessagesPerSession — сообщений в одном диалоге.
	maxMessagesPerSession = 5000
	// maxSessionBytes — файл одной сессии.
	maxSessionBytes int64 = 16 << 20 // 16 МБ
	// maxServerBytes — все сессии сервера вместе.
	maxServerBytes int64 = 256 << 20 // 256 МБ
	// maxSessions — сколько диалогов сервер держит одновременно.
	maxSessions = 2000
	// maxAccessCodes — сколько гостевых кодов можно выпустить.
	maxAccessCodes = 50
)

// Ошибки лимитов: API превращает их в 413 / 409 / 507.
var (
	ErrMessageTooLarge = errors.New("сообщение больше допустимого размера")
	ErrSessionTooLarge = errors.New("сессия переполнена")
	ErrServerFull      = errors.New("на сервере закончилось место")
)

// messageBytes — оценка веса сообщения в JSON. Не точный размер файла,
// но достаточный, чтобы остановиться до того, как закончится память.
func messageBytes(m Message) int64 {
	size := len(m.Content) + len(m.Usage) + len(m.Attachments) +
		len(m.ID) + len(m.SessionID) + len(m.Model) + len(m.Kind) +
		len(m.Role) + len(m.ResponderID) + len(m.ServerID)
	return int64(size) + 160
}

// messagesBytes — суммарный вес списка сообщений.
func messagesBytes(messages []Message) int64 {
	var size int64
	for _, m := range messages {
		size += messageBytes(m)
	}
	return size
}

// sessionBytes — вес сессии: заголовок плюс сообщения.
func sessionBytes(file *sessionFile) int64 {
	size := int64(512) +
		int64(len(file.Session.Title)+len(file.Session.AgentID)+len(file.Session.OwnerID))
	if file.Session.Summary != nil {
		size += int64(len(file.Session.Summary.Text)+len(file.Session.Summary.Model)) + 128
	}
	return size + messagesBytes(file.Messages)
}

// checkMessageSize отсекает сообщение, которое само по себе больше лимита.
func checkMessageSize(message Message) error {
	size := int64(len(message.Content) + len(message.Usage) + len(message.Attachments))
	if size > maxMessageBytes {
		return ErrMessageTooLarge
	}
	return nil
}
