package main

import (
	"fmt"
	"strings"
	"time"
)

// sessionMarkdown — диалог в markdown: заголовок, шапка, сообщения по порядку.
// Служебные типы (мысли, вызовы инструментов) не выбрасываются, а помечаются,
// чтобы файл оставался честной копией переписки.
func sessionMarkdown(session Session, messages []Message) string {
	var b strings.Builder

	fmt.Fprintf(&b, "# %s\n\n", session.Title)
	fmt.Fprintf(&b, "_Gena · создан %s · сообщений: %d_", formatTime(session.CreatedAt), len(messages))
	if len(session.Tags) > 0 {
		fmt.Fprintf(&b, " · теги: %s", strings.Join(session.Tags, ", "))
	}
	b.WriteString("\n\n---\n\n")

	for _, message := range messages {
		b.WriteString(renderHeader(message))
		b.WriteString("\n\n")
		b.WriteString(renderBody(message))
		b.WriteString("\n\n")
	}
	return strings.TrimRight(b.String(), "\n") + "\n"
}

func renderHeader(message Message) string {
	switch message.Kind {
	case "thought":
		return "> 💭 _мысль модели_"
	case "tool_calls":
		return "> 🛠 _вызов инструмента_"
	}
	switch message.Role {
	case "assistant":
		label := "**Агент**"
		if message.Model != "" {
			label += fmt.Sprintf(" · `%s`", message.Model)
		}
		return label + " · " + formatTime(message.CreatedAt)
	case "system":
		return "_системное сообщение_ · " + formatTime(message.CreatedAt)
	default:
		return "**Вы** · " + formatTime(message.CreatedAt)
	}
}

func renderBody(message Message) string {
	content := message.Content
	if message.Kind == "thought" {
		lines := strings.Split(content, "\n")
		for i, line := range lines {
			lines[i] = "> " + line
		}
		return strings.Join(lines, "\n")
	}
	if message.Kind == "tool_calls" {
		return "```json\n" + content + "\n```"
	}
	if len(message.Attachments) > 0 {
		content += "\n\n_вложения: " + string(message.Attachments) + "_"
	}
	return content
}

func formatTime(ms int64) string {
	if ms <= 0 {
		return "—"
	}
	return time.UnixMilli(ms).Format("02.01.2006 15:04")
}
