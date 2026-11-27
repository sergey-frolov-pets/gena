/**
 * Клиент серверной части Gena.
 *
 * Сервер — отдельный Go-бинарник (см. `server/`): хранит диалоги и отдаёт их
 * по HTTP с Bearer-токеном. Здесь только сеть и типы, без Vue и без хранилища.
 */

import type { GenaServer } from "@/storage/types";
import { openAgentKey } from "@/crypto/agent-key-cipher";

export interface ServerInfo {
  name: string;
  version: string;
  sessions: number;
}

/** Сессия в том виде, в каком её отдаёт сервер. */
export interface ServerSession {
  id: string;
  title: string;
  agentId?: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  tags?: string[];
  tokenMode?: boolean;
  messageCount?: number;
  /** Проект на сервере (id записи проекта). */
  projectId?: string;
  /** Саммари сессии, если считали; `stale` — сообщения изменились. */
  summary?: ServerSummary | null;
}

/** Саммари на сервере: текст + ревизия исходника. */
export interface ServerSummary {
  text: string;
  model?: string;
  updatedAt: number;
  revision?: string;
  stale?: boolean;
  characters?: number;
}

/** Проект на сервере: имя, состав, саммари. */
export interface ServerProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sessionIds?: string[];
  summary?: ServerSummary | null;
  messageCount?: number;
}

export interface ServerMessage {
  id: string;
  sessionId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  kind?: "text" | "thought" | "tool_calls";
  model?: string;
  responderId?: string;
  serverId?: string;
  editedAt?: number;
  usage?: unknown;
  attachments?: unknown;
}

export interface ServerSessionPayload {
  session: ServerSession;
  messages: ServerMessage[];
}

export class GenaServerError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "GenaServerError";
  }
}

/** Агент на сервере: ключ провайдера остаётся там, клиент видит только описание. */
export interface ServerAgent {
  id: string;
  name: string;
  model: string;
  /** Хост провайдера, без ключа — для подписи в списке. */
  provider?: string;
}

/** Адрес без хвоста `/api` и без завершающего слеша: `https://host` или `http://ip:8787`. */
export function normalizeServerUrl(input: string): string {
  let value = String(input ?? "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) {
    // Локальный адрес по http, всё остальное — по https.
    value = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(value) ? `http://${value}` : `https://${value}`;
  }
  value = value.replace(/\/+$/, "");
  value = value.replace(/\/api$/i, "");
  return value;
}

async function request<T>(
  base: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers });
  } catch (e) {
    throw new GenaServerError(e instanceof Error ? `сеть: ${e.message}` : "сеть недоступна");
  }

  if (!response.ok) {
    let detail = `код ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) detail = payload.error;
    } catch {
      // Тело не JSON — оставляем код ответа.
    }
    throw new GenaServerError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GenaServerError("сервер ответил не JSON");
  }
}

/** Проверка связи до сохранения: health открыт, токен проверяется не здесь. */
export async function checkGenaServer(url: string, token: string): Promise<ServerInfo> {
  const base = normalizeServerUrl(url);
  if (!base) throw new GenaServerError("адрес пустой");
  const info = await request<{ ok?: boolean; name?: string; version?: string; sessions?: number }>(
    base,
    token,
    "/api/health",
  );
  if (!info || info.ok !== true) {
    throw new GenaServerError("ответ не похож на Gena server");
  }
  return {
    name: info.name || "Gena server",
    version: info.version || "",
    sessions: Number(info.sessions) || 0,
  };
}

export class GenaServerClient {
  constructor(readonly url: string, readonly token: string) {}

  /** Агенты, доступные на сервере: id, имя, модель. Ключей здесь нет. */
  async listAgents(): Promise<ServerAgent[]> {
    const list = await request<ServerAgent[]>(this.url, this.token, "/api/agents");
    if (!Array.isArray(list)) return [];
    return list.filter((a) => a && typeof a.id === "string" && a.id.trim() !== "");
  }

  list(): Promise<ServerSession[]> {
    return request<ServerSession[]>(this.url, this.token, "/api/sessions");
  }

  create(title: string, agentId = ""): Promise<ServerSession> {
    return request<ServerSession>(this.url, this.token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title, agentId }),
    });
  }

  get(id: string): Promise<ServerSessionPayload> {
    return request<ServerSessionPayload>(
      this.url,
      this.token,
      `/api/sessions/${encodeURIComponent(id)}`,
    );
  }

  importSession(
    id: string,
    session: {
      title?: string;
      agentId?: string;
      pinned?: boolean;
      tags?: string[];
      tokenMode?: boolean;
      projectId?: string;
      summary?: { text: string; model?: string; updatedAt?: number } | null;
    },
    messages: ServerMessage[],
  ): Promise<ServerSession> {
    return request<ServerSession>(
      this.url,
      this.token,
      `/api/sessions/${encodeURIComponent(id)}/import`,
      { method: "POST", body: JSON.stringify({ session, messages }) },
    );
  }

  append(id: string, message: Partial<ServerMessage>): Promise<ServerMessage> {
    return request<ServerMessage>(
      this.url,
      this.token,
      `/api/sessions/${encodeURIComponent(id)}/messages`,
      { method: "POST", body: JSON.stringify(message) },
    );
  }

  patch(
    id: string,
    body: { title?: string; pinned?: boolean; tags?: string[]; projectId?: string },
  ): Promise<ServerSession> {
    return request<ServerSession>(this.url, this.token, this.path("/api/sessions", id), {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  // ---------- Проекты ----------

  listProjects(): Promise<ServerProject[]> {
    return request<ServerProject[]>(this.url, this.token, "/api/projects");
  }

  createProject(name: string, sessionIds: string[] = []): Promise<ServerProject> {
    return request<ServerProject>(this.url, this.token, "/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, sessionIds }),
    });
  }

  patchProject(id: string, body: { name?: string; sessionIds?: string[] }): Promise<ServerProject> {
    return request<ServerProject>(this.url, this.token, this.path("/api/projects", id), {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  removeProject(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(this.url, this.token, this.path("/api/projects", id), {
      method: "DELETE",
    });
  }

  /** Саммари сессии: текст считает клиент, сервер хранит и проверяет ревизию. */
  putSessionSummary(id: string, text: string, model = ""): Promise<ServerSession> {
    return request<ServerSession>(
      this.url,
      this.token,
      this.path("/api/sessions", id) + "/summary",
      { method: "POST", body: JSON.stringify({ text, model }) },
    );
  }

  removeSessionSummary(id: string): Promise<ServerSession> {
    return request<ServerSession>(
      this.url,
      this.token,
      this.path("/api/sessions", id) + "/summary",
      { method: "DELETE" },
    );
  }

  putProjectSummary(id: string, text: string, model = ""): Promise<ServerProject> {
    return request<ServerProject>(
      this.url,
      this.token,
      this.path("/api/projects", id) + "/summary",
      { method: "POST", body: JSON.stringify({ text, model }) },
    );
  }

  removeProjectSummary(id: string): Promise<ServerProject> {
    return request<ServerProject>(
      this.url,
      this.token,
      this.path("/api/projects", id) + "/summary",
      { method: "DELETE" },
    );
  }

  /** Путь с экранированием id: без шаблонных строк, чтобы не мешал guard. */
  private path(prefix: string, id: string): string {
    return prefix + "/" + encodeURIComponent(id);
  }

  remove(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(this.url, this.token, `/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  /** Прямая ссылка на markdown-файл: нужен токен, поэтому качаем через fetch. */
  exportUrl(id: string): string {
    return `${this.url}/api/sessions/${encodeURIComponent(id)}/export.md`;
  }

  async exportMarkdown(id: string): Promise<string> {
    const headers = new Headers();
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const response = await fetch(this.exportUrl(id), { headers });
    if (!response.ok) throw new GenaServerError(`код ${response.status}`, response.status);
    return response.text();
  }
}

/** Клиент по записи сервера; токен расшифровывается ключом устройства. */
export async function clientFor(
  server: GenaServer,
  token?: string,
): Promise<GenaServerClient> {
  const value = token ?? (await openAgentKey(server.sealedToken, server.id));
  return new GenaServerClient(normalizeServerUrl(server.url), value);
}
