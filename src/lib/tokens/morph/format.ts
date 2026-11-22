/**
 * Формат скачиваемого морфологического словаря (`gena.morph`, версия 1).
 *
 * Словарь — обычный JSON, который кладётся рядом с приложением и качается один
 * раз. Внутри — компактные парадигмы: по лемме лежат готовые формы падежей,
 * поэтому в браузере не нужен ни морфологический анализатор, ни правила
 * склонения.
 *
 * Запись существительного:
 *   { "p": "N", "g": "m", "f": [ном., род., дат., вин., тв., пред.,
 *                               ном. мн., род. мн., дат. мн., вин. мн.,
 *                               тв. мн., пред. мн.] }
 * Запись прилагательного — 24 формы: 6 падежей × (муж., жен., ср.) единственного
 * числа, затем 6 падежей множественного.
 *
 * Отсутствующая форма (pluralia tantum, дефектная парадигма) — `null`:
 * такой вариант просто не строится, выдумывать форму нельзя.
 */

export const MORPH_FORMAT = "gena.morph";
export const MORPH_VERSION = 1;

/** Порядок падежей в файле. Менять нельзя — это часть формата. */
export const MORPH_CASES = ["nomn", "gent", "datv", "accs", "ablt", "loct"] as const;

/** Слотов у существительного: 6 падежей × 2 числа. */
export const NOUN_SLOTS = MORPH_CASES.length * 2;

/** Слотов у прилагательного: 6 падежей × 3 рода + 6 падежей множественного. */
export const ADJ_SLOTS = MORPH_CASES.length * 3 + MORPH_CASES.length;

/** Пределы, чтобы битый или чужой файл не съел память устройства. */
export const MORPH_MAX_LEMMAS = 300_000;
export const MORPH_MAX_BYTES = 32 * 1024 * 1024;
export const MORPH_MIN_LEMMAS = 100;

export type MorphGender = "m" | "f" | "n";

export interface MorphNounEntry {
  p: "N";
  g?: MorphGender;
  f: (string | null)[];
}

export interface MorphAdjEntry {
  p: "A";
  f: (string | null)[];
}

export type MorphLemmaEntry = MorphNounEntry | MorphAdjEntry;

export interface MorphDictionary {
  format: string;
  version: number;
  createdAt?: string;
  source?: string;
  license?: string;
  cases: readonly string[];
  lemmas: Record<string, MorphLemmaEntry>;
}

export type MorphFileErrorCode =
  | "bad_json"
  | "not_object"
  | "bad_format"
  | "bad_version"
  | "bad_cases"
  | "bad_lemmas"
  | "bad_lemma"
  | "too_many_lemmas"
  | "empty";

export class MorphFileError extends Error {
  readonly code: MorphFileErrorCode;

  constructor(code: MorphFileErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "MorphFileError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeForms(raw: unknown, slots: number, lemma: string): (string | null)[] {
  if (!Array.isArray(raw) || raw.length !== slots) {
    throw new MorphFileError("bad_lemma", lemma);
  }
  const forms: (string | null)[] = [];
  for (const item of raw) {
    if (item === null || item === undefined) {
      forms.push(null);
      continue;
    }
    if (typeof item !== "string") throw new MorphFileError("bad_lemma", lemma);
    const trimmed = item.trim();
    forms.push(trimmed.length > 0 ? trimmed : null);
  }
  return forms;
}

/** Разобрать и проверить содержимое файла. Бросает `MorphFileError`. */
export function parseMorphDictionary(input: unknown): MorphDictionary {
  if (!isRecord(input)) throw new MorphFileError("not_object");
  if (input.format !== MORPH_FORMAT) throw new MorphFileError("bad_format", String(input.format));
  if (input.version !== MORPH_VERSION) throw new MorphFileError("bad_version", String(input.version));

  const cases = input.cases;
  if (
    !Array.isArray(cases) ||
    cases.length !== MORPH_CASES.length ||
    MORPH_CASES.some((name, index) => cases[index] !== name)
  ) {
    throw new MorphFileError("bad_cases");
  }

  if (!isRecord(input.lemmas)) throw new MorphFileError("bad_lemmas");
  const keys = Object.keys(input.lemmas);
  if (keys.length === 0) throw new MorphFileError("empty");
  if (keys.length > MORPH_MAX_LEMMAS) throw new MorphFileError("too_many_lemmas", String(keys.length));

  const lemmas: Record<string, MorphLemmaEntry> = {};
  for (const key of keys) {
    const lemma = key.trim().toLowerCase();
    if (!lemma) throw new MorphFileError("bad_lemma", key);
    const raw = input.lemmas[key];
    if (!isRecord(raw)) throw new MorphFileError("bad_lemma", key);
    if (raw.p === "N") {
      const gender = raw.g === "m" || raw.g === "f" || raw.g === "n" ? raw.g : undefined;
      const entry: MorphNounEntry = { p: "N", f: normalizeForms(raw.f, NOUN_SLOTS, key) };
      if (gender) entry.g = gender;
      lemmas[lemma] = entry;
      continue;
    }
    if (raw.p === "A") {
      lemmas[lemma] = { p: "A", f: normalizeForms(raw.f, ADJ_SLOTS, key) };
      continue;
    }
    throw new MorphFileError("bad_lemma", key);
  }

  const dict: MorphDictionary = {
    format: MORPH_FORMAT,
    version: MORPH_VERSION,
    cases: [...MORPH_CASES],
    lemmas,
  };
  if (typeof input.createdAt === "string") dict.createdAt = input.createdAt;
  if (typeof input.source === "string") dict.source = input.source;
  if (typeof input.license === "string") dict.license = input.license;
  return dict;
}

/** Разобрать текст файла: JSON + проверка структуры. */
export function readMorphJson(text: string): MorphDictionary {
  if (!text || text.length < 2) throw new MorphFileError("bad_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MorphFileError("bad_json");
  }
  return parseMorphDictionary(parsed);
}
