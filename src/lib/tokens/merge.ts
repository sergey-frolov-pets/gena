/**
 * Слияние импортируемых записей с уже имеющимся справочником.
 *
 * Совпадение — это одинаковое имя без учёта регистра. Решение по каждой
 * совпавшей записи принимает человек: «заменить мою» или «оставить мою».
 * Здесь только чистая логика, без UI.
 */

import type { TransferEntry } from "./transfer";
import { tokenNameKey } from "./format";

export type MergePolicy = "replace" | "keep";

export interface ExistingEntry {
  name: string;
  updatedAt?: number;
}

export interface MergeConflict {
  /** Ключ совпадения (имя в нижнем регистре). */
  nameKey: string;
  /** Имя в файле — как его увидит человек. */
  name: string;
  existing: ExistingEntry;
  incoming: TransferEntry;
}

/** Какие записи файла уже есть на устройстве. */
export function findConflicts(
  existing: ExistingEntry[],
  incoming: TransferEntry[],
): MergeConflict[] {
  const byKey = new Map<string, ExistingEntry>();
  for (const entry of existing) {
    const key = tokenNameKey(entry.name);
    if (key && !byKey.has(key)) byKey.set(key, entry);
  }

  const conflicts: MergeConflict[] = [];
  for (const entry of incoming) {
    const key = tokenNameKey(entry.name);
    const found = byKey.get(key);
    if (!found) continue;
    conflicts.push({ nameKey: key, name: entry.name, existing: found, incoming: entry });
  }
  return conflicts;
}

export interface MergePlan {
  /** Новые записи и записи на замену — их надо сохранить. */
  write: TransferEntry[];
  /** Совпадения: их было с чем сравнить. */
  conflicts: MergeConflict[];
  /** Имена, где своя запись осталась нетронутой. */
  kept: string[];
}

/**
 * План слияния. `decide` вызывается только для совпадений; по умолчанию
 * совпавшие записи заменяются файлом («заменить всё»).
 */
export function planMerge(
  existing: ExistingEntry[],
  incoming: TransferEntry[],
  decide: (conflict: MergeConflict) => MergePolicy = () => "replace",
): MergePlan {
  const conflicts = findConflicts(existing, incoming);
  const conflictByKey = new Map(conflicts.map((item) => [item.nameKey, item]));

  const write: TransferEntry[] = [];
  const kept: string[] = [];
  const seen = new Set<string>();

  for (const entry of incoming) {
    const key = tokenNameKey(entry.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const conflict = conflictByKey.get(key);
    if (conflict && decide(conflict) === "keep") {
      kept.push(entry.name);
      continue;
    }
    write.push(entry);
  }

  return { write, conflicts, kept };
}
