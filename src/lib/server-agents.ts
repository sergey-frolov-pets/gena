/**
 * Серверные агенты в общем списке подключений.
 *
 * Агент, заведённый на Gena-сервере, в базе устройства не хранится: при
 * загрузке мы спрашиваем `/api/agents` у каждого сервера и собираем из
 * ответа «псевдоагентов» с id `srv:<serverId>:<agentId>`. Ключ провайдера
 * остаётся на сервере — в записи лежит только токен сервера.
 */

import { clientFor, normalizeServerUrl, type ServerAgent } from "@/lib/gena-server";
import { listServers } from "@/storage/db";
import type { Agent, GenaServer, ServerAgentConfig } from "@/storage/types";

/** Префикс id: по нему сразу видно, что агент пришёл с сервера. */
export const SERVER_AGENT_PREFIX = "srv:";

export function isServerAgent(agent: Agent | undefined | null): boolean {
  return agent?.origin === "server";
}

export function serverAgentId(serverId: string, agentId: string): string {
  return `${SERVER_AGENT_PREFIX}${serverId}:${agentId}`;
}

/** Разобрать id обратно: `srv:<serverId>:<agentId>` (agentId может содержать двоеточия). */
export function splitServerAgentId(id: string): { serverId: string; agentId: string } | null {
  if (!id.startsWith(SERVER_AGENT_PREFIX)) return null;
  const rest = id.slice(SERVER_AGENT_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { serverId: rest.slice(0, cut), agentId: rest.slice(cut + 1) };
}

function toAgent(server: GenaServer, spec: ServerAgent): Agent {
  const now = Date.now();
  const config: ServerAgentConfig = {
    serverId: server.id,
    agentId: spec.id,
    model: spec.model,
  };
  return {
    id: serverAgentId(server.id, spec.id),
    name: (spec.name || spec.id).trim(),
    address: normalizeServerUrl(server.url),
    // Токен сервера уже запечатан его собственным ключом — не перешифровываем.
    sealedKey: server.sealedToken,
    settings: { contextSize: 20, callLimit: 0, llmModel: spec.model },
    protocol: "gena_server",
    config,
    origin: "server",
    createdAt: now,
    updatedAt: now,
  };
}

/** Спросить агентов у всех серверов; упавший сервер просто не даёт записей. */
export async function fetchServerAgents(servers?: GenaServer[]): Promise<Agent[]> {
  const list = servers ?? (await listServers());
  const rows = await Promise.all(
    list.map(async (server) => {
      try {
        const client = await clientFor(server);
        const specs = await client.listAgents();
        return specs.map((spec) => toAgent(server, spec));
      } catch (error) {
        console.warn("серверные агенты недоступны", server.name || server.url, error);
        return [] as Agent[];
      }
    }),
  );
  return rows.flat();
}

/** Локальные записи сильнее: одноимённый id с сервера не подменяет подключение. */
export function mergeAgents(local: Agent[], remote: Agent[]): Agent[] {
  const seen = new Set(local.map((agent) => agent.id));
  return [...local, ...remote.filter((agent) => !seen.has(agent.id))];
}
