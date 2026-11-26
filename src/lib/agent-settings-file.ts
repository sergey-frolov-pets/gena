/**
 * Файл настроек агентов: JSON или YAML.
 * Ключи (sealedKey) в файл не пишутся и при загрузке игнорируются.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseBackup, type BackupAgent } from "@/storage/backup";
import type { Agent } from "@/storage/types";

export const AGENTS_FILE_FORMAT = "gena-agents";
export const AGENTS_FILE_VERSION = 1;

export interface AgentsFile {
  format: typeof AGENTS_FILE_FORMAT;
  version: number;
  agents: BackupAgent[];
}

function withoutKey(agent: Agent): BackupAgent {
  return {
    id: agent.id,
    name: agent.name,
    address: agent.address,
    settings: { ...agent.settings },
    protocol: agent.protocol,
    config: agent.config ? { ...agent.config } : undefined,
    privacy: agent.privacy,
    tokenOnly: agent.tokenOnly ? true : undefined,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export function agentsFileFrom(agents: Agent[]): AgentsFile {
  return {
    format: AGENTS_FILE_FORMAT,
    version: AGENTS_FILE_VERSION,
    agents: agents.map(withoutKey),
  };
}

export function serializeAgentsJson(file: AgentsFile): string {
  return JSON.stringify(file, null, 2);
}

export function serializeAgentsYaml(file: AgentsFile): string {
  return stringifyYaml(file);
}

function stripAgentSecrets(agent: unknown): unknown {
  if (typeof agent !== "object" || agent === null) return agent;
  const copy = { ...(agent as Record<string, unknown>) };
  delete copy.sealedKey;
  delete copy.apiKey;
  return copy;
}

/** Разобрать JSON или YAML. Полный бэкап истории тоже принимается: берутся только агенты. */
export function parseAgentsFile(text: string): BackupAgent[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty agents file");
  let raw: unknown;
  try {
    raw = trimmed.startsWith("{") || trimmed.startsWith("[") ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(detail);
  }
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  const listed = Array.isArray(raw) ? raw : record?.agents;
  const agents = Array.isArray(listed) ? listed.map(stripAgentSecrets) : listed;
  if (!Array.isArray(agents)) throw new Error("agents file has no agents array");

  if (record?.format === "gena-backup") {
    return parseBackup(JSON.stringify({ ...record, agents })).agents;
  }

  return parseBackup(
    JSON.stringify({
      format: "gena-backup",
      version: 1,
      exportedAt: Date.now(),
      notice: "",
      agents,
      sessions: [],
      messages: [],
    }),
  ).agents;
}
