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
import { clientFor, GenaServerError } from "@/lib/gena-server";
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
    // Какое подключение держит этот диалог: по нему синхронизация находит сервер.
    // Раньше поле не заполнялось, и переименование не доходило до сервера.
    serverRef: server.id,
  };
  await putSession(session);
  return session;
}

/**
 * Открытия в работе: два быстрых тапа по одной строке списка иначе успевают
 * обе пройти проверку «локальной копии нет» и создают два одинаковых диалога.
 */
const opening = new Map<string, Promise<Session>>();

/** Открыть серверный диалог локально: есть копия — обновляем, нет — создаём. */
export async function openServerSession(
  serverId: string,
  remoteId: string,
  agentId: string,
): Promise<Session> {
  const key = `${serverId}:${remoteId}`;
  const running = opening.get(key);
  if (running) return running;
  const task = openServerSessionOnce(serverId, remoteId, agentId).finally(() => {
    opening.delete(key);
  });
  opening.set(key, task);
  return task;
}

async function openServerSessionOnce(
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
    // Старые записи не знали, каким подключением созданы: чиним при открытии,
    // иначе переименование снова не дойдёт до сервера.
    if (existing.serverRef !== server.id) {
      existing.serverRef = server.id;
      await putSession(existing);
    }
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
    serverRef: server.id,
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
  // Название сервер не должен затирать, если локально его правили позже:
  // иначе переименование откатывается к «Новый диалог» при следующем открытии.
  const localNewer = session.updatedAt > (remote.updatedAt || 0);
  if (!localNewer && remote.title && remote.title !== session.title) session.title = remote.title;
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
  const servers = await listServers();
  // Подключение хранится в serverRef. У записей, созданных до этого поля, его нет:
  // тогда берём сервер, на котором такая сессия действительно есть.
  // Проверка client.get обязательна — importSession создаёт сессию на любом
  // сервере, и без неё переименование плодило бы пустые диалоги-дубли.
  const preferred = session.serverRef
    ? servers.filter((item) => item.id === session.serverRef)
    : [];
  const candidates = [
    ...preferred,
    ...servers.filter((item) => !preferred.includes(item)),
  ];
  if (candidates.length === 0) return false;

  const messages = await listMessages(sessionId);
  let failure = "";
  for (const server of candidates) {
    try {
      const client = await clientFor(server);
      await client.get(session.serverId);
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
      if (session.serverRef !== server.id) {
        // Запомнили подключение: следующий синк пойдёт сразу на нужный сервер.
        await putSession({ ...session, serverRef: server.id });
      }
      serverSyncError.value = null;
      return true;
    } catch (e) {
      // 404 — это не ошибка синхронизации, а «сессии здесь нет»: идём дальше.
      if (e instanceof GenaServerError && e.status === 404) continue;
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  if (failure) serverSyncError.value = { sessionId, message: failure };
  return false;
}

/** Список диалогов на сервере — для выбора перед открытием. */
export async function listServerSessions(serverId: string) {
  const server = await getServer(serverId);
  if (!server) throw new Error("сервер не найден");
  const client = await clientFor(server);
  return client.list();
}
