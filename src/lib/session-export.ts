/**
 * Экспорт диалога в markdown без сервера: файл собирается из локальной истории.
 * Формат совпадает с серверным `/api/sessions/{id}/export.md`, чтобы выгрузка
 * с сервера и из браузера выглядела одинаково.
 */

import type { Message, Session } from "@/storage/types";

export function sessionToMarkdown(session: Session, messages: Message[]): string {
  const lines: string[] = [];
  lines.push(`# ${session.title || "Новый диалог"}`, "");
  const head = [`Gena · создан ${formatTime(session.createdAt)}`, `сообщений: ${messages.length}`];
  if (session.tags?.length) head.push(`теги: ${session.tags.join(", ")}`);
  lines.push(`_${head.join(" · ")}_`, "", "---", "");
  for (const message of messages) {
    lines.push(messageHeader(message), "", messageBody(message), "");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function messageHeader(message: Message): string {
  if (message.kind === "thought") return "> 💭 _мысль модели_";
  if (message.kind === "tool_calls") return "> 🛠 _вызов инструмента_";
  if (message.role === "assistant") {
    const label = message.model ? `**Агент** · \`${message.model}\`` : "**Агент**";
    return `${label} · ${formatTime(message.createdAt)}`;
  }
  if (message.role === "system") return `_системное сообщение_ · ${formatTime(message.createdAt)}`;
  return `**Вы** · ${formatTime(message.createdAt)}`;
}

function messageBody(message: Message): string {
  if (message.kind === "thought") {
    return message.content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (message.kind === "tool_calls") return `\`\`\`json\n${message.content}\n\`\`\``;
  const files = (message.attachments ?? []).filter((item) => item.kind === "file");
  if (files.length === 0) return message.content;
  const names = files.map((item) => item.name || "файл").join(", ");
  return `${message.content}\n\n_вложения: ${names}_`;
}

function formatTime(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Имя файла без запрещённых символов: кириллица остаётся, ОС её понимает. */
export function markdownFileName(title: string): string {
  const base = String(title || "gena")
    .trim()
    .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 60)
    .trim();
  return `${base || "gena"}.md`;
}

/** Скачать текст файлом — браузер предложит «Сохранить». */
export function downloadText(filename: string, text: string, type = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Даём браузеру начать скачивание, потом освобождаем память.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
