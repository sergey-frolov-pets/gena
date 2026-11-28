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
    // Диалог создали здесь: только этот клиент может убрать его с сервера.
    serverOwned: true,
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
    // Режим гостя мог поменять инициатор с другого устройства — берём с сервера.
    const remoteMode = payload.session.continuation === "view" ? "view" : "all";
    if (existing.continuation !== remoteMode) {
      existing.continuation = remoteMode;
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
    ...(payload.session.continuation === "view" ? { continuation: "view" as const } : {}),
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

/** Итог удаления на сервере: `remote` — удалось ли убрать диалог с сервера. */
export interface RemoteDeleteResult {
  ok: boolean;
  /** Что ответил сервер, если удалить не удалось. */
  message?: string;
}

/**
 * Убрать диалог с сервера — только у инициатора.
 *
 * Подключившийся позже диалог с сервера не удаляет: он ему не принадлежит,
 * у остальных переписка должна остаться. Такой вызов просто возвращает `ok`
 * и не ходит в сеть — вызывающий удаляет локальную копию.
 *
 * `serverRef` заполняется при создании, но у записей до 27.11.2026 его может
 * не быть: тогда перебираем подключения, как это делает синхронизация.
 */
export async function deleteServerSession(session: Session): Promise<RemoteDeleteResult> {
  if (!session.serverId || !session.serverOwned) return { ok: true };
  const servers = await listServers();
  if (servers.length === 0) return { ok: false, message: "нет подключения к серверу" };
  const preferred = session.serverRef
    ? servers.filter((item) => item.id === session.serverRef)
    : [];
  const candidates = [...preferred, ...servers.filter((item) => !preferred.includes(item))];

  let failure = "";
  for (const server of candidates) {
    try {
      const client = await clientFor(server);
      await client.remove(session.serverId);
      return { ok: true };
    } catch (e) {
      // 404 — диалога там уже нет: цель достигнута, это не ошибка.
      if (e instanceof GenaServerError && e.status === 404) return { ok: true };
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, message: failure };
}

/**
 * Удалить с серверов пачку диалогов — те, где этот клиент инициатор.
 *
 * Для массовой чистки («удалить выбранные», «удалить всё»): ошибки сети не
 * останавливают работу, вызывающий только сообщает, сколько не удалось убрать.
 */
export async function deleteServerSessionsRemote(
  sessions: readonly Session[],
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const session of sessions) {
    if (!session.serverId || !session.serverOwned) continue;
    const result = await deleteServerSession(session);
    if (result.ok) removed += 1;
    else failed += 1;
  }
  return { removed, failed };
}

/**
 * Режим гостя в моём серверном диалоге: `all` — гость продолжает переписку,
 * `view` — только читает.
 *
 * Меняет инициатор диалога (владелец сервера или гость, начавший его):
 * сервер сам проверит права и вернёт 403 чужому. Локальная копия обновляется
 * сразу — при следующей синхронизации подтянется и на сервер.
 */
export async function setSessionContinuation(
  sessionId: string,
  mode: "all" | "view",
): Promise<Session> {
  const session = await getSession(sessionId);
  if (!session) throw new Error("диалог не найден");
  if (!session.serverId) throw new Error("диалог не привязан к серверу");

  const servers = session.serverRef
    ? [await getServer(session.serverRef)].filter((item): item is NonNullable<typeof item> => Boolean(item))
    : await listServers();
  if (servers.length === 0) throw new Error("нет подключения к серверу");

  let failure = "";
  for (const server of servers) {
    try {
      const client = await clientFor(server);
      await client.patch(session.serverId, { continuation: mode });
      const updated: Session = { ...session, continuation: mode, serverRef: server.id };
      await putSession(updated);
      return updated;
    } catch (e) {
      // 404 — этот сервер не знает диалога, пробуем следующее подключение.
      if (e instanceof GenaServerError && e.status === 404) {
        failure = e.message;
        continue;
      }
      throw e;
    }
  }
  throw new Error(failure || "диалог не найден ни на одном сервере");
}
