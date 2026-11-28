/**
 * Права на проекты на сервере.
 *
 * Владелец и гость с полным доступом управляют проектами; гость, которому
 * выдали отдельные проекты, — только смотрит. Сервер отвечает такому гостю
 * 403, поэтому интерфейс заранее прячет кнопки «создать» и «удалить»,
 * а не показывает их и потом ругается ошибкой.
 */

import { clientFor } from "@/lib/gena-server";
import { listServers } from "@/storage/db";

export interface ProjectScope {
  /** Можно ли создавать, переименовывать и удалять проекты. */
  manage: boolean;
  /** Сервер, который ограничил права: имя для подсказки. */
  serverName?: string;
}

/** Сколько живёт ответ: лишний запрос на каждое открытие модалки не нужен. */
const CACHE_MS = 60_000;

let cache: { at: number; value: ProjectScope } | null = null;

/** Сбрасывается, когда сервер добавили, удалили или перевыпустили код. */
export function resetProjectScopeCache(): void {
  cache = null;
}

/**
 * Спрашивает каждый подключённый сервер, ограничены ли наши права.
 *
 * Первый же сервер с ограничением решает дело: проекты локальные, но
 * зеркалятся на сервер, поэтому «половина прав» смысла не имеет.
 */
export async function projectScope(force = false): Promise<ProjectScope> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: ProjectScope = { manage: true };
  let servers: Awaited<ReturnType<typeof listServers>> = [];
  try {
    servers = await listServers();
  } catch {
    // Хранилище недоступно — считаем, что не ограничены: сервер всё равно
    // ответит 403, и это покажется обычной ошибкой.
    return value;
  }
  for (const server of servers) {
    try {
      const status = await (await clientFor(server)).status();
      if (status.role === "guest" && status.scopeAll === false) {
        value = { manage: false, serverName: server.name || server.url };
        break;
      }
    } catch {
      // Сервер молчит — не повод запрещать: решение принимает тот, кто ответит.
      continue;
    }
  }
  cache = { at: Date.now(), value };
  return value;
}
