/**
 * Поиск персональных данных моделью на своём сервере (OpenAI-совместимый чат).
 *
 * Настройка живёт в «Подключениях» (`model-settings.ts`). Если она не задана,
 * функция сразу возвращает `disabled` — вызывающий код остаётся на локальном
 * детекторе, и щит выглядит как раньше.
 *
 * Что уходит: только текст сообщения. Ключи и значения справочника — нет.
 * Что приходит: координаты фрагментов и тип; текст фрагмента используется
 * лишь для восстановления спана, если модель ошиблась в индексах.
 */

import type { Finding, FindingType } from "@/lib/privacy/detect";
import {
  isPrivacyModelReady,
  privacyChatUrl,
  privacyModel,
  readPrivacyModelKey,
  type PrivacyModelSettings,
} from "@/lib/privacy/model-settings";

export type ModelScanErrorCode = "disabled" | "too_long" | "network" | "bad_response";

export interface ModelScanFailure {
  ok: false;
  code: ModelScanErrorCode;
  message: string;
}

export interface ModelScanSuccess {
  ok: true;
  findings: Finding[];
}

export type ModelScanResult = ModelScanSuccess | ModelScanFailure;

/** Длиннее — режем: сообщение чата столько не занимает, а ждать ответа долго. */
const MAX_TEXT = 8000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_FINDINGS = 200;

const MODEL_TYPES: readonly FindingType[] = [
  "person",
  "address",
  "phone",
  "email",
  "money",
  "date",
  "card",
  "account",
];

export const MODEL_SCAN_SYSTEM = [
  "Ты — детектор персональных данных в русском тексте.",
  "Найди фрагменты, которые человек не хотел бы отдавать внешнему сервису:",
  "ФИО и имена, почтовые адреса, телефоны, email, денежные суммы, даты,",
  "номера банковских карт и расчётных счетов.",
  "Верни ТОЛЬКО JSON без пояснений и без markdown:",
  '{"findings":[{"start":0,"end":0,"type":"person","text":"точная подстрока"}]}',
  "start — индекс символа (UTF-16), end — не включая; text обязателен и должен",
  "точно совпадать с исходным текстом на этих позициях.",
  "Допустимые type: person, address, phone, email, money, date, card, account.",
  "Не придумывай фрагменты, не переписывай текст, не добавляй другие поля.",
].join(" ");

export interface ScanWithModelOptions {
  settings?: PrivacyModelSettings;
  timeoutMs?: number;
  /** Подмена fetch в тестах. */
  fetchImpl?: typeof fetch;
}

/** Вырезать JSON из ответа модели: снимает ```json … ``` и лишний текст вокруг. */
export function extractJsonBlock(raw: string): string {
  const text = String(raw ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1].trim() : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return "";
  return body.slice(first, last + 1);
}

function allIndexes(haystack: string, needle: string, limit = 20): number[] {
  if (!needle) return [];
  const found: number[] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0 && found.length < limit) {
    found.push(at);
    at = haystack.indexOf(needle, at + Math.max(1, needle.length));
  }
  return found;
}

function dropOverlaps(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Finding[] = [];
  for (const item of sorted) {
    const last = kept[kept.length - 1];
    if (last && item.start < last.end) {
      const itemLen = item.end - item.start;
      const lastLen = last.end - last.start;
      if (itemLen > lastLen) kept[kept.length - 1] = item;
      continue;
    }
    kept.push(item);
  }
  return kept;
}

/**
 * Разобрать ответ модели в находки. Индексы проверяются по тексту: неверные
 * заменяются поиском точной подстроки, мусор отбрасывается молча.
 */
export function parseModelFindings(text: string, raw: string): Finding[] {
  const json = extractJsonBlock(raw);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const list = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];

  const findings: Finding[] = [];
  for (const entry of list.slice(0, MAX_FINDINGS)) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { start?: unknown; end?: unknown; type?: unknown; text?: unknown };
    const type = String(item.type ?? "").trim().toLowerCase() as FindingType;
    if (!MODEL_TYPES.includes(type)) continue;

    const start = Number(item.start);
    const end = Number(item.end);
    const exact = typeof item.text === "string" ? item.text : "";

    const indexesOk =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= text.length &&
      (!exact || text.slice(start, end) === exact);

    if (indexesOk) {
      findings.push({
        start,
        end,
        type,
        value: text.slice(start, end),
        confidence: 0.85,
      });
      continue;
    }

    for (const at of allIndexes(text, exact)) {
      findings.push({
        start: at,
        end: at + exact.length,
        type,
        value: exact,
        confidence: 0.8,
      });
    }
  }

  return dropOverlaps(findings);
}

/**
 * Запрос к модели. Любая проблема — `ok: false` и причина; вызывающий код
 * обязан молча откатиться на локальный детектор, а не падать.
 */
export async function scanWithModel(
  text: string,
  options: ScanWithModelOptions = {},
): Promise<ModelScanResult> {
  const settings = options.settings ?? privacyModel.value;
  if (!isPrivacyModelReady(settings)) {
    return { ok: false, code: "disabled", message: "поиск моделью не настроен" };
  }
  if (!text.trim()) return { ok: true, findings: [] };
  if (text.length > MAX_TEXT) {
    return { ok: false, code: "too_long", message: `текст длиннее ${MAX_TEXT} символов` };
  }

  const url = privacyChatUrl(settings.address);
  if (!url) return { ok: false, code: "disabled", message: "некорректный адрес модели" };

  let key = "";
  try {
    key = await readPrivacyModelKey(settings);
  } catch {
    key = "";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = options.fetchImpl ?? fetch;

  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: 2000,
        messages: [
          { role: "system", content: MODEL_SCAN_SYSTEM },
          { role: "user", content: text },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, code: "network", message: `http ${response.status}` };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content) return { ok: false, code: "bad_response", message: "пустой ответ модели" };

    return { ok: true, findings: parseModelFindings(text, content) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      code: "network",
      message: aborted ? "таймаут ответа модели" : "модель недоступна",
    };
  } finally {
    clearTimeout(timeout);
  }
}
