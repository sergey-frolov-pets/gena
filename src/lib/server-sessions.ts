/**
 * Серверные сессии Gena.
 *
 * Локальная копия остаётся в IndexedDB (интерфейс работает как раньше),
 * а сервер хранит ту же переписку, чтобы диалог открывался с другого устройства.
 * Синхронизация — полный импорт сессии: сервер заменяет сообщения целиком,
 * поэтому повторная отправка ничего не дублирует.
 */

import { ref } from "vue";
import { newId } from "@/lib/id";
import { clientFor } from "@/lib/gena-server";
import {
  getServer,
  getSession,
  listMessages,
  listServers,
  listSessions,
  putMessage,
  putSession,
} from "@/storage/db";
import type { Message, Session } from "@/storage/types";
import type { ServerMessage, ServerSession } from "@/lib/gena-server";

/** Последняя ошибка синхронизации — интерфейс показывает её одной строкой. */
export const serverSyncError = ref<{ sessionId: string; message: string } | null>(null);

/** Создать диалог сразу на сервере и локально (копия для офлайна). */
export async function createServerSession(
  serverId: string,
  title: string,
  agentId: string,
): Promise<Session> {
  const server = await getServer(serverId);
  if (!server) throw new Error("сервер не найден");
  const client = await clientFor(server);
  const remote = await client.create(title || "Новый диалог", agentId);
  const now = Date.now();
  const session: Session = {
    id: newId("sess"),
    agentId,
    title: remote.title || title || "Новый диалог",
    createdAt: remote.createdAt || now,
    updatedAt: remote.updatedAt || now,
    messageCount: 0,
    serverId: remote.id,
  };
  await putSession(session);
  return session;
}

/** Открыть серверный диалог локально: есть копия — обновляем, нет — создаём. */
export async function openServerSession(
  serverId: string,
  remoteId: string,
  agentId: string,
): Promise<Session> {
  const server = await getServer(serverId);
  if (!server) throw new Error("сервер не найден");
  const client = await clientFor(server);
  const payload = await client.get(remoteId);

  const existing = (await listSessions()).find(
    (item) => item.serverId === payload.session.id,
  );
  if (existing) {
    await pullMessages(existing, payload.session, payload.messages);
    return existing;
  }

  const now = Date.now();
  const session: Session = {
    id: newId("sess"),
    agentId: payload.session.agentId || agentId,
    title: payload.session.title || "Новый диалог",
    createdAt: payload.session.createdAt || now,
    updatedAt: payload.session.updatedAt || now,
    messageCount: 0,
    serverId: payload.session.id,
    ...(payload.session.pinned ? { pinned: true } : {}),
    ...(payload.session.tags?.length ? { tags: [...payload.session.tags] } : {}),
    ...(payload.session.tokenMode ? { tokenMode: true } : {}),
  };
  await putSession(session);
  await pullMessages(session, payload.session, payload.messages);
  return session;
}

/** Дописать недостающие сообщения с сервера; свои не трогаем. */
async function pullMessages(
  session: Session,
  remote: ServerSession,
  remoteMessages: ServerMessage[],
): Promise<void> {
  const local = await listMessages(session.id);
  const known = new Set(local.map((message) => message.remoteId).filter(Boolean) as string[]);
  let added = 0;
  for (const item of remoteMessages) {
    if (!item.id || known.has(item.id)) continue;
    const message: Message = {
      id: newId("msg"),
      sessionId: session.id,
      role: item.role,
      content: item.content,
      createdAt: item.createdAt || Date.now(),
      remoteId: item.id,
      ...(item.kind && item.kind !== "text" ? { kind: item.kind } : {}),
      ...(item.model ? { model: item.model } : {}),
      ...(item.responderId ? { responderId: item.responderId } : {}),
      ...(item.attachments ? { attachments: item.attachments as Message["attachments"] } : {}),
    };
    await putMessage(message);
    added += 1;
  }
  if (remote.title && remote.title !== session.title) session.title = remote.title;
  session.messageCount = local.length + added;
  session.updatedAt = Math.max(session.updatedAt, remote.updatedAt || 0);
  await putSession(session);
}

/**
 * Синхронизация с задержкой: при потоке сообщений (агент печатает) не дёргаем
 * сервер на каждую строку, а отправляем итог через 400 мс.
 */
const timers = new Map<string, number>();

export function scheduleServerSync(sessionId: string): void {
  if (typeof window === "undefined") return;
  const prev = timers.get(sessionId);
  if (prev) window.clearTimeout(prev);
  const timer = window.setTimeout(() => {
    timers.delete(sessionId);
    void syncSessionToServer(sessionId);
  }, 400);
  timers.set(sessionId, timer);
}

/** Отправить сессию на сервер целиком. Возвращает true, если синхронизировали. */
export async function syncSessionToServer(sessionId: string): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session?.serverId) return false;
  const server = (await listServers()).find((item) => item.id === session.serverId);
  if (!server) return false;
  try {
    const client = await clientFor(server);
    const messages = await listMessages(sessionId);
    await client.importSession(
      session.serverId,
      {
        title: session.title,
        agentId: session.agentId,
        pinned: session.pinned,
        tags: session.tags,
        tokenMode: session.tokenMode,
      },
      messages.map((message) => ({
        id: message.remoteId ?? message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        kind: message.kind,
        model: message.model,
        responderId: message.responderId,
        ...(message.usage !== undefined ? { usage: message.usage } : {}),
        ...(message.attachments ? { attachments: message.attachments } : {}),
      })),
    );
    serverSyncError.value = null;
    return true;
  } catch (e) {
    serverSyncError.value = {
      sessionId,
      message: e instanceof Error ? e.message : String(e),
    };
    return false;
  }
}

/** Список диалогов на сервере — для выбора перед открытием. */
export async function listServerSessions(serverId: string) {
  const server = await getServer(serverId);
  if (!server) throw new Error("сервер не найден");
  const client = await clientFor(server);
  return client.list();
}
