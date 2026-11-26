/**
 * Сборка контекста из чипов композера.
 *
 * Чип — ссылка на сессию или проект в одном из двух режимов:
 *   full    — весь диалог в markdown (обрезается по лимиту);
 *   summary — сжатая выжимка, которую считает выбранный агент и кеширует.
 *
 * Готовое саммари не пересчитывается: сервер помечает его `stale`, когда
 * в диалоге появились новые сообщения. Локальные сессии живут без сервера,
 * поэтому у них саммари считается заново только если его ещё нет.
 */

import { composeMessage, type ContextChip, type ContextPart, summaryUsable } from "@/lib/context-bridge";
import { clientFor } from "@/lib/gena-server";
import {
  freshSession,
  projectSessions,
  projectWithMessages,
  saveProjectSummary,
  saveSessionSummary,
} from "@/lib/projects";
import { transcriptOfProject, transcriptOfSession, summarize } from "@/lib/summary";
import { sessionToMarkdown } from "@/lib/session-export";
import { getProject, listMessages, listSessions, listServers } from "@/storage/db";
import type { Agent, Message, Project, Session } from "@/storage/types";

export interface ResolveOptions {
  agent: Agent;
  apiKey: string;
  peers?: Agent[];
  openKey?: (agent: Agent) => Promise<string>;
  signal?: AbortSignal;
  /** Что происходит с чипом: нужно, чтобы чип показал «считаю…». */
  onState?: (key: string, state: "summarizing" | "done" | "error") => void;
}

export interface ResolveResult {
  parts: ContextPart[];
  /** Чипы, которые не удалось собрать: сообщение показываем пользователю. */
  errors: { key: string; title: string; message: string }[];
  /** Ключи чипов, для которых саммари пересчитали сейчас. */
  computed: string[];
}

/** Сессия с сервера, если локальной копии нет. */
async function remoteSession(
  remoteId: string,
): Promise<{ session: Session; messages: Message[] } | null> {
  for (const server of await listServers()) {
    try {
      const client = await clientFor(server);
      const payload = await client.get(remoteId);
      const session = payload.session;
      return {
        session: {
          id: remoteId,
          agentId: session.agentId ?? "",
          title: session.title || "без названия",
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          serverId: remoteId,
          serverRef: server.id,
          messageCount: (payload.messages ?? []).length,
        },
        messages: (payload.messages ?? []).map((message) => ({
          id: message.id,
          sessionId: remoteId,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          kind: message.kind,
        })),
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function sourceOfSession(
  chip: ContextChip,
): Promise<{ session: Session; messages: Message[] } | null> {
  const local = await freshSession(chip.id);
  if (local) {
    return { session: local, messages: await listMessages(local.id) };
  }
  if (chip.remoteId) return remoteSession(chip.remoteId);
  return null;
}

/** Полный текст проекта: диалоги подряд, каждый со своим заголовком. */
function projectFullText(entries: { session: Session; messages: Message[] }[]): string {
  return entries
    .map(({ session, messages }) => `## ${session.title || "без названия"}\n\n${sessionToMarkdown(session, messages)}`)
    .join("\n\n");
}

async function partOfSession(chip: ContextChip, options: ResolveOptions, computed: string[]): Promise<ContextPart> {
  const source = await sourceOfSession(chip);
  if (!source) throw new Error("диалог не найден");
  if (chip.mode === "full") {
    return {
      kind: "session",
      mode: "full",
      title: source.session.title,
      body: sessionToMarkdown(source.session, source.messages),
    };
  }
  if (summaryUsable(chip)) {
    return { kind: "session", mode: "summary", title: source.session.title, body: chip.summary!.text };
  }
  options.onState?.(chip.key, "summarizing");
  const result = await summarize({
    agent: options.agent,
    apiKey: options.apiKey,
    title: source.session.title,
    body: transcriptOfSession(source.session, source.messages),
    kind: "session",
    signal: options.signal,
    peers: options.peers,
    openKey: options.openKey,
  });
  await saveSessionSummary(source.session, {
    text: result.text,
    model: result.model,
    updatedAt: Date.now(),
    stale: false,
  });
  computed.push(chip.key);
  return { kind: "session", mode: "summary", title: source.session.title, body: result.text };
}

async function partOfProject(chip: ContextChip, options: ResolveOptions, computed: string[]): Promise<ContextPart> {
  const project = await getProject(chip.id);
  if (!project) throw new Error("проект не найден");
  const sessions = await listSessions();
  const own = projectSessions(project, sessions);
  if (own.length === 0) throw new Error("в проекте нет диалогов");
  const entries = await projectWithMessages(project, sessions);
  if (chip.mode === "full") {
    return {
      kind: "project",
      mode: "full",
      title: project.name,
      body: projectFullText(entries),
      sessionCount: own.length,
    };
  }
  if (summaryUsable(chip)) {
    return { kind: "project", mode: "summary", title: project.name, body: chip.summary!.text };
  }
  options.onState?.(chip.key, "summarizing");
  const result = await summarize({
    agent: options.agent,
    apiKey: options.apiKey,
    title: project.name,
    body: transcriptOfProject(entries),
    kind: "project",
    signal: options.signal,
    peers: options.peers,
    openKey: options.openKey,
  });
  await saveProjectSummary(project.id, {
    text: result.text,
    model: result.model,
    updatedAt: Date.now(),
    stale: false,
  });
  computed.push(chip.key);
  return {
    kind: "project",
    mode: "summary",
    title: project.name,
    body: result.text,
    sessionCount: own.length,
  };
}

/** Собирает части контекста по чипам. Ошибки не роняют остальные чипы. */
export async function resolveContext(chips: ContextChip[], options: ResolveOptions): Promise<ResolveResult> {
  const parts: ContextPart[] = [];
  const errors: ResolveResult["errors"] = [];
  const computed: string[] = [];
  for (const chip of chips) {
    try {
      const part =
        chip.kind === "project"
          ? await partOfProject(chip, options, computed)
          : await partOfSession(chip, options, computed);
      if (part.body.trim()) parts.push(part);
      options.onState?.(chip.key, "done");
    } catch (error) {
      options.onState?.(chip.key, "error");
      errors.push({
        key: chip.key,
        title: chip.title,
        message: error instanceof Error ? error.message : "не удалось собрать контекст",
      });
    }
  }
  return { parts, errors, computed };
}

/** Текст для агента: контекст перед вопросом. */
export function withContext(text: string, parts: ContextPart[]): string {
  return composeMessage(text, parts);
}

/** Готовое саммари проекта для чипа (из кеша проекта). */
export function projectChipSummary(project: Project) {
  return project.summary;
}
