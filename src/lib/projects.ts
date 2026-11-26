/**
 * Проекты Gena: группы сессий с общим саммари.
 *
 * Проект живёт локально (IndexedDB) и, если он привязан к серверу,
 * зеркалится туда: имя, состав и саммари. Сессии в проекте хранятся
 * локальными id, на сервер уходят их серверные id — поэтому проект остаётся
 * осмысленным и на другом устройстве.
 */

import { newId } from "@/lib/id";
import { clientFor } from "@/lib/gena-server";
import {
  deleteProject as dbDeleteProject,
  getServer,
  getSession,
  listMessages,
  listProjects,
  listServers,
  listSessions,
  putProject,
  putSession,
} from "@/storage/db";
import type { CachedSummary, Project, Session } from "@/storage/types";
import type { Message } from "@/storage/types";

export const PROJECT_NAME_LIMIT = 120;

export function cleanProjectName(name: string): string {
  const value = String(name ?? "").replace(/\s+/g, " ").trim();
  return value.slice(0, PROJECT_NAME_LIMIT) || "Проект";
}

/** Сессии проекта в порядке «свежие сверху». */
export function projectSessions(project: Project, sessions: Session[]): Session[] {
  const index = new Map(sessions.map((session) => [session.id, session]));
  return project.sessionIds
    .map((id) => index.get(id))
    .filter((session): session is Session => Boolean(session))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(name: string, sessionIds: string[] = []): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: newId("proj"),
    name: cleanProjectName(name),
    createdAt: now,
    updatedAt: now,
    sessionIds: [],
  };
  await putProject(project);
  if (sessionIds.length > 0) {
    return setProjectSessions(project.id, sessionIds);
  }
  return project;
}

/** Состав проекта: чистит повторы и несуществующие сессии, правит их `projectId`. */
export async function setProjectSessions(id: string, sessionIds: string[]): Promise<Project> {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("проект не найден");
  const sessions = await listSessions();
  const known = new Set(sessions.map((session) => session.id));
  const next: string[] = [];
  for (const sessionId of sessionIds) {
    if (known.has(sessionId) && !next.includes(sessionId)) next.push(sessionId);
  }
  const previous = new Set(project.sessionIds);
  project.sessionIds = next;
  project.updatedAt = Date.now();
  await putProject(project);
  // Сессии, выбывшие из проекта, открепляем; вошедшие — привязываем.
  for (const session of sessions) {
    const inside = next.includes(session.id);
    if (inside && session.projectId !== id) {
      await putSession({ ...session, projectId: id });
    } else if (!inside && session.projectId === id && previous.has(session.id)) {
      const copy = { ...session };
      delete copy.projectId;
      await putSession(copy);
    }
  }
  return project;
}

export async function addSessionToProject(id: string, sessionId: string): Promise<Project> {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("проект не найден");
  return setProjectSessions(id, [...project.sessionIds, sessionId]);
}

export async function removeSessionFromProject(id: string, sessionId: string): Promise<Project> {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("проект не найден");
  return setProjectSessions(
    id,
    project.sessionIds.filter((item) => item !== sessionId),
  );
}

export async function renameProject(id: string, name: string): Promise<Project> {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("проект не найден");
  project.name = cleanProjectName(name);
  project.updatedAt = Date.now();
  await putProject(project);
  return project;
}

/** Удаляет проект; сессии остаются, но теряют привязку. */
export async function removeProject(id: string): Promise<void> {
  const sessions = await listSessions();
  for (const session of sessions) {
    if (session.projectId !== id) continue;
    const copy = { ...session };
    delete copy.projectId;
    await putSession(copy);
  }
  await dbDeleteProject(id);
}

/** Сохраняет саммари проекта локально и, если проект серверный, на сервере. */
export async function saveProjectSummary(id: string, summary: CachedSummary): Promise<Project> {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("проект не найден");
  project.summary = { ...summary, updatedAt: summary.updatedAt || Date.now() };
  project.updatedAt = Date.now();
  await putProject(project);
  if (project.serverId) {
    try {
      const server = await getServer(project.serverId);
      if (server) {
        const client = await clientFor(server);
        const remote = await client.putProjectSummary(
          remoteProjectId(project),
          project.summary.text,
          project.summary.model ?? "",
        );
        if (remote.summary) {
          project.summary = { ...project.summary, ...toCached(remote.summary) };
          await putProject(project);
        }
      }
    } catch {
      // Сервер недоступен — саммари остаётся локальным, синхронизируем позже.
    }
  }
  return project;
}

/** id проекта на сервере: отдельное поле, чтобы не путать с локальным. */
function remoteProjectId(project: Project): string {
  return project.remoteId ?? project.id;
}

function toCached(summary: { text: string; model?: string; updatedAt: number; revision?: string; stale?: boolean; characters?: number }): CachedSummary {
  return {
    text: summary.text,
    model: summary.model,
    updatedAt: summary.updatedAt,
    revision: summary.revision,
    stale: summary.stale,
    characters: summary.characters,
  };
}

/** Все сессии проекта с сообщениями — для саммари. */
export async function projectWithMessages(
  project: Project,
  sessions: Session[],
): Promise<{ session: Session; messages: Message[] }[]> {
  const own = projectSessions(project, sessions);
  const out: { session: Session; messages: Message[] }[] = [];
  for (const session of own) {
    out.push({ session, messages: await listMessages(session.id) });
  }
  return out;
}

/** Синхронизация проекта с сервером: имя, состав (серверные id), саммари. */
export async function syncProjectToServer(id: string): Promise<boolean> {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === id);
  if (!project?.serverId) return false;
  const server = await getServer(project.serverId);
  if (!server) return false;
  const sessions = await listSessions();
  const remoteIds = projectSessions(project, sessions)
    .map((session) => session.serverId)
    .filter((value): value is string => Boolean(value));
  try {
    const client = await clientFor(server);
    let remoteId = project.remoteId;
    if (remoteId) {
      await client.patchProject(remoteId, { name: project.name, sessionIds: remoteIds });
    } else {
      const created = await client.createProject(project.name, remoteIds);
      remoteId = created.id;
      project.remoteId = created.id;
    }
    if (project.summary?.text) {
      await client.putProjectSummary(remoteId, project.summary.text, project.summary.model ?? "");
    }
    project.updatedAt = Date.now();
    await putProject(project);
    // Сессии проекта помечаем на сервере, чтобы со стороны сервера проект был виден.
    for (const session of projectSessions(project, sessions)) {
      if (!session.serverId) continue;
      try {
        await client.patch(session.serverId, { projectId: remoteId });
      } catch {
        // Одна сессия не привязалась — остальные всё равно синхронизируем.
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Кеш саммари сессии: локально и, если диалог серверный, на сервере. */
export async function saveSessionSummary(session: Session, summary: CachedSummary): Promise<void> {
  const copy: Session = {
    ...session,
    summary: { ...summary, updatedAt: summary.updatedAt || Date.now() },
  };
  await putSession(copy);
  if (!session.serverId) return;
  // Какая запись сервера держит диалог, знает serverRef; в старых записях его
  // нет — тогда пробуем серверы по очереди, пока один не примет саммари.
  const servers = await listServers();
  const ordered = session.serverRef
    ? [...servers.filter((item) => item.id === session.serverRef), ...servers.filter((item) => item.id !== session.serverRef)]
    : servers;
  for (const server of ordered) {
    try {
      const client = await clientFor(server);
      const remote = await client.putSessionSummary(
        session.serverId,
        copy.summary!.text,
        copy.summary!.model ?? "",
      );
      copy.serverRef = server.id;
      if (remote.summary) {
        copy.summary = { ...copy.summary, ...toCached(remote.summary) };
      }
      await putSession(copy);
      return;
    } catch {
      continue;
    }
  }
}

/** Свежая копия сессии из хранилища — чтобы не работать с устаревшим объектом. */
export async function freshSession(id: string): Promise<Session | undefined> {
  return getSession(id);
}
