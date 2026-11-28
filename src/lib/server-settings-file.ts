/**
 * Файл настроек серверов Gena: JSON или YAML.
 * Токены (sealedToken) в файл не пишутся и при загрузке не заменяются.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { normalizeServerUrl } from "@/lib/gena-server";
import type { GenaServer } from "@/storage/types";
import type { MergeResult } from "@/storage/backup";

export const SERVERS_FILE_FORMAT = "gena-servers";
export const SERVERS_FILE_VERSION = 1;

/** Сервер в файле: без токена и без снимка проверки — они живут только на устройстве. */
export interface ServerFileEntry {
  id?: string;
  name: string;
  url: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ServersFile {
  format: typeof SERVERS_FILE_FORMAT;
  version: number;
  servers: ServerFileEntry[];
}

function withoutSecrets(server: GenaServer): ServerFileEntry {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

export function serversFileFrom(servers: GenaServer[]): ServersFile {
  return {
    format: SERVERS_FILE_FORMAT,
    version: SERVERS_FILE_VERSION,
    servers: servers.map(withoutSecrets),
  };
}

export function serializeServersJson(file: ServersFile): string {
  return JSON.stringify(file, null, 2);
}

export function serializeServersYaml(file: ServersFile): string {
  return stringifyYaml(file);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toEntry(raw: unknown): ServerFileEntry {
  const record = asRecord(raw);
  if (!record) throw new Error("server entry is not an object");
  const url = normalizeServerUrl(typeof record.url === "string" ? record.url : "");
  if (!url) throw new Error("server entry has no url");
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : url;
  return {
    id,
    name,
    url,
    createdAt: optionalNumber(record.createdAt),
    updatedAt: optionalNumber(record.updatedAt),
  };
}

/** Разобрать JSON или YAML: массив серверов или объект с полем `servers`. */
export function parseServersFile(text: string): ServerFileEntry[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty servers file");
  let raw: unknown;
  try {
    raw = trimmed.startsWith("{") || trimmed.startsWith("[") ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(detail);
  }
  const record = asRecord(raw);
  const listed = Array.isArray(raw) ? raw : record?.servers;
  if (!Array.isArray(listed)) throw new Error("servers file has no servers array");
  return listed.map(toEntry);
}

/**
 * Слить серверы: совпадение по id, затем по адресу.
 * Токен берётся у существующего сервера — импорт его не трогает.
 * Новый сервер создаётся без токена: его вводят в правке карточки.
 */
export function mergeServers(
  current: GenaServer[],
  incoming: ServerFileEntry[],
  now = Date.now(),
): MergeResult<GenaServer> {
  const byId = new Map(current.map((server) => [server.id, server]));
  const byUrl = new Map(current.map((server) => [normalizeServerUrl(server.url), server]));
  const toWrite: GenaServer[] = [];
  let added = 0;
  let updated = 0;

  for (const entry of incoming) {
    const existing =
      (entry.id ? byId.get(entry.id) : undefined) ?? byUrl.get(normalizeServerUrl(entry.url));
    if (existing) {
      toWrite.push({
        ...existing,
        name: entry.name,
        url: entry.url,
        updatedAt: now,
      });
      updated += 1;
      continue;
    }
    toWrite.push({
      id: entry.id ?? `srv-${now.toString(36)}-${added}`,
      name: entry.name,
      url: entry.url,
      sealedToken: "",
      createdAt: entry.createdAt ?? now,
      updatedAt: entry.updatedAt ?? now,
    });
    added += 1;
  }

  return { toWrite, added, updated, skipped: 0 };
}
