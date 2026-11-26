/**
 * Саммари сессии и проекта.
 *
 * Считает выбранный агент (у сервера Gena нет ключей моделей): текст диалога
 * сжимается в короткую выжимку, которая потом уходит в контекст другого
 * диалога вместо всей переписки. Готовое саммари кешируется — на сервере для
 * серверных сессий, локально для локальных.
 */

import { sendToAgent } from "@/lib/agent-client";
import { SUMMARY_SOURCE_LIMIT, truncateContext } from "@/lib/context-bridge";
import { sessionToMarkdown } from "@/lib/session-export";
import type { Agent, Message, Session } from "@/storage/types";

/** Отдельный «диалог» у агента: саммари не должно попадать в память чата. */
const SUMMARY_SESSION = "gena-summary";

export interface SummaryResult {
  text: string;
  model?: string;
  /** Исходник не поместился целиком — саммари по обрезанному тексту. */
  truncated: boolean;
}

/** Диалог в текст для саммари: markdown как в экспорте, но без шапки с датами. */
export function transcriptOfSession(_session: Pick<Session, "title">, messages: Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.kind === "thought") continue;
    if (message.kind === "tool_calls") continue;
    const who = message.role === "assistant" ? "Агент" : message.role === "system" ? "Система" : "Пользователь";
    parts.push(`${who}: ${message.content.trim()}`);
  }
  return parts.join("\n\n");
}

/** Несколько диалогов проекта — по порядку, каждый со своим заголовком. */
export function transcriptOfProject(
  sessions: { session: Pick<Session, "title">; messages: Message[] }[],
): string {
  return sessions
    .map(({ session, messages }) => {
      const body = transcriptOfSession(session, messages);
      if (!body.trim()) return "";
      return `### ${session.title || "без названия"}\n\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export type SummaryKind = "session" | "project";

/** Инструкция агенту: только факты, без пересказа и без вступлений. */
export function summaryInstruction(title: string, body: string, kind: SummaryKind = "session"): string {
  const what =
    kind === "project"
      ? `несколько диалогов одного проекта «${title}»`
      : `один диалог «${title}»`;
  return [
    `Сожми ${what} в саммари для передачи в другой диалог.`,
    "",
    "Правила:",
    "- только то, что есть в тексте; ничего не додумывай;",
    "- сохрани решения, договорённости, цифры, имена, сроки и термины;",
    "- отдельным блоком «Открытые вопросы» — что осталось нерешённым;",
    "- 150–400 слов, короткими пунктами, без вступлений вроде «в этом диалоге»;",
    "- не цитируй реплики целиком.",
    "",
    "Текст:",
    body,
    "",
    "Ответь только саммари, без пояснений.",
  ].join("\n");
}

export interface SummarizeOptions {
  agent: Agent;
  apiKey: string;
  title: string;
  body: string;
  kind?: SummaryKind;
  signal?: AbortSignal;
  peers?: Agent[];
  openKey?: (agent: Agent) => Promise<string>;
}

/** Убирает тройные кавычки, если модель обернула ответ в блок кода. */
export function cleanSummary(raw: string): string {
  let text = String(raw ?? "").trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  return text;
}

/** Считает саммари выбранным агентом. Сеть — одна отправка без истории. */
export async function summarize(options: SummarizeOptions): Promise<SummaryResult> {
  const { agent, apiKey, title } = options;
  const source = truncateContext(options.body, SUMMARY_SOURCE_LIMIT);
  if (!source.text.trim()) {
    throw new Error("нечего сжимать: текст пустой");
  }
  const response = await sendToAgent(
    agent,
    apiKey,
    {
      message: summaryInstruction(title, source.text, options.kind ?? "session"),
      sessionId: SUMMARY_SESSION,
      settings: { ...agent.settings, contextSize: 0 },
      history: [],
    },
    {
      signal: options.signal,
      peers: options.peers,
      openKey: options.openKey,
    },
  );
  const text = cleanSummary(response.reply);
  if (!text) {
    throw new Error("агент вернул пустой ответ");
  }
  return { text, model: response.model, truncated: source.truncated };
}

/** Саммари из готовых сессии и сообщений — короткая обёртка для UI. */
export async function summarizeSession(
  session: Session,
  messages: Message[],
  options: Omit<SummarizeOptions, "title" | "body" | "kind">,
): Promise<SummaryResult> {
  const body = transcriptOfSession(session, messages);
  return summarize({ ...options, title: session.title, body, kind: "session" });
}

/** Саммари проекта из его сессий. */
export async function summarizeProject(
  name: string,
  sessions: { session: Session; messages: Message[] }[],
  options: Omit<SummarizeOptions, "title" | "body" | "kind">,
): Promise<SummaryResult> {
  return summarize({
    ...options,
    title: name,
    body: transcriptOfProject(sessions),
    kind: "project",
  });
}

/** Полный текст диалога для режима «передать целиком». */
export function fullSessionText(session: Session, messages: Message[]): string {
  return sessionToMarkdown(session, messages);
}
