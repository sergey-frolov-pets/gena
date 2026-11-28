/**
 * Объединение находок: локальный детектор + модель на своём сервере.
 *
 * Локальный слой обязателен и работает всегда. Модель — надстройка: если её
 * нет, недоступна или ответила мусором, результат совпадает с локальным,
 * а наружу отдаётся причина (`modelError`), чтобы щит мог показать «локально».
 */

import { detectFindings, type Finding, type FindingType } from "@/lib/privacy/detect";
import {
  scanWithModel,
  type ModelScanErrorCode,
  type ScanWithModelOptions,
} from "@/lib/privacy/model-scan";

/** При равной уверенности и длине побеждает более специфичный тип. */
const WEIGHT: Record<FindingType, number> = {
  card: 8,
  account: 7,
  phone: 6,
  address: 5,
  date: 4,
  money: 3,
  person: 2,
  email: 1,
};

function better(candidate: Finding, current: Finding): boolean {
  if (Math.abs(candidate.confidence - current.confidence) > 0.05) {
    return candidate.confidence > current.confidence;
  }
  const candidateLen = candidate.end - candidate.start;
  const currentLen = current.end - current.start;
  if (candidateLen !== currentLen) return candidateLen > currentLen;
  return WEIGHT[candidate.type] > WEIGHT[current.type];
}

/**
 * Слить два списка: перекрывающиеся спаны схлопываются в один — самый
 * уверенный, затем самый длинный, затем самый специфичный по типу.
 * Локальные находки идут первыми: при полном равенстве они не проигрывают.
 */
export function mergeFindings(
  local: readonly Finding[],
  remote: readonly Finding[],
): Finding[] {
  const all = [...local, ...remote];
  if (all.length === 0) return [];

  const sorted = [...all].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Finding[] = [];
  for (const item of sorted) {
    const last = kept[kept.length - 1];
    if (last && item.start < last.end) {
      if (better(item, last)) kept[kept.length - 1] = item;
      continue;
    }
    kept.push(item);
  }
  return kept;
}

export interface PrivacyScanOptions extends ScanWithModelOptions {
  /** Отключить модель принудительно (например, для черновика на каждое нажатие). */
  model?: boolean;
}

export interface PrivacyScanOutcome {
  findings: Finding[];
  /** `local` — модель не участвовала; `local+model` — участвовала. */
  source: "local" | "local+model";
  modelError?: ModelScanErrorCode;
}

/**
 * Единственная точка скана. Модель вызывается только если разрешена; ошибка
 * модели не пробрасывается наружу — скан не должен мешать человеку печатать.
 */
export async function scanPrivacy(
  text: string,
  options: PrivacyScanOptions = {},
): Promise<PrivacyScanOutcome> {
  const local = detectFindings(text);
  if (options.model === false) return { findings: local, source: "local" };

  const remote = await scanWithModel(text, options);
  if (!remote.ok) {
    return { findings: local, source: "local", modelError: remote.code };
  }

  return {
    findings: mergeFindings(local, remote.findings),
    source: "local+model",
  };
}
