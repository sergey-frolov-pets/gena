/**
 * Падежные формы значений по скачанному словарю.
 *
 * Правила, за которые этот файл отвечает:
 *  - склоняются только слова, которые есть в словаре; незнакомое слово
 *    остаётся как написано, а не «угадывается» по правилам;
 *  - вариант строится целиком: если у одного слова парадигма дефектная,
 *    вариант отбрасывается, а не выдаётся наполовину;
 *  - регистр исходного слова сохраняется («Вклад» → «Вклада», «Альфа-Банк» →
 *    «Альфа-Банка»);
 *  - имя собственное внутри значения (слово с прописной буквы после первого)
 *    и всё, что стоит после предлога, не склоняется: «улица Ленина» →
 *    «улицы Ленина», «вклад ВТБ в Альфа-Банке» → «вклада ВТБ в Альфа-Банке»;
 *  - у мужского неодушевлённого винительный совпадает с именительным, поэтому
 *    прилагательное не превращается в «текущего счёт»;
 *  - явные варианты записи всегда главнее словаря (это решает `registry`).
 */

import {
  ADJ_SLOTS,
  MORPH_CASES,
  NOUN_SLOTS,
  type MorphDictionary,
  type MorphLemmaEntry,
} from "./format";

export interface MorphParse {
  lemma: string;
  pos: "N" | "A";
  caseIndex: number;
  plural: boolean;
}

export interface MorphIndex {
  /** Сколько словоформ в индексе — для отчёта в интерфейсе. */
  readonly formCount: number;
  /** Сколько лемм попало в индекс. */
  readonly lemmaCount: number;
  lookup(word: string): readonly MorphParse[] | undefined;
  entry(lemma: string): MorphLemmaEntry | undefined;
}

export interface DeclensionResult {
  /** Готовые написания значения — без исходного. */
  variants: string[];
  /** Сколько склоняемых слов значения словарь знает. */
  covered: number;
  /** Всего склоняемых слов в значении. */
  total: number;
  /** Склоняемые слова, которых нет в словаре (остаются как есть). */
  unknown: string[];
}

type Target = { caseIndex: number; plural: boolean };

const WORD_RE = /[\p{L}][\p{L}\p{N}\-']*/gu;
const NON_LETTER = /[^\p{L}]/gu;
const SPACES = /\s+/g;

/**
 * После предлога падеж задан предлогом: «в Альфа-Банке» не превращается
 * в «в Альфа-Банка» при склонении ведущего слова.
 */
const PREPOSITIONS = new Set([
  "в", "во", "на", "у", "от", "до", "для", "с", "со", "по", "о", "об", "обо",
  "при", "к", "ко", "из", "изо", "за", "под", "подо", "над", "про", "без",
  "безо", "между", "через", "около", "после", "перед", "передо", "вокруг",
  "кроме", "ради", "сквозь", "среди", "вместо", "насчёт", "вследствие",
]);

function pushParse(map: Map<string, MorphParse[]>, form: string, parse: MorphParse): void {
  const key = form.toLowerCase();
  const list = map.get(key);
  if (!list) {
    map.set(key, [parse]);
    return;
  }
  const same = list.some(
    (item) => item.lemma === parse.lemma && item.caseIndex === parse.caseIndex && item.plural === parse.plural,
  );
  if (!same) list.push(parse);
}

/** Индекс «словоформа → разборы». Строится один раз после загрузки словаря. */
export function buildMorphIndex(dict: MorphDictionary): MorphIndex {
  const map = new Map<string, MorphParse[]>();
  let lemmaCount = 0;
  for (const [lemma, entry] of Object.entries(dict.lemmas)) {
    lemmaCount += 1;
    if (entry.p === "N") {
      for (let slot = 0; slot < NOUN_SLOTS; slot += 1) {
        const form = entry.f[slot];
        if (!form) continue;
        pushParse(map, form, { lemma, pos: "N", caseIndex: slot % 6, plural: slot >= 6 });
      }
      continue;
    }
    for (let slot = 0; slot < ADJ_SLOTS; slot += 1) {
      const form = entry.f[slot];
      if (!form) continue;
      const plural = slot >= 18;
      pushParse(map, form, {
        lemma,
        pos: "A",
        caseIndex: plural ? slot - 18 : Math.floor(slot / 3),
        plural,
      });
    }
  }
  // «ё» и «е» пишут по-разному — обе формы должны находиться.
  for (const [form, parses] of [...map]) {
    if (!form.includes("ё")) continue;
    const alias = form.replace(/ё/g, "е");
    if (!map.has(alias)) map.set(alias, parses);
  }
  const frozen = map;
  return {
    formCount: frozen.size,
    lemmaCount,
    lookup(word: string) {
      return frozen.get(word.toLowerCase());
    },
    entry(lemma: string) {
      return dict.lemmas[lemma];
    },
  };
}

/** Разбор, который лучше всего подходит как «именительный единственного». */
function pickParse(parses: readonly MorphParse[] | undefined): MorphParse | undefined {
  if (!parses || parses.length === 0) return undefined;
  return (
    parses.find((item) => item.caseIndex === 0 && !item.plural) ??
    parses.find((item) => item.caseIndex === 0) ??
    parses[0]
  );
}

function lettersOf(word: string): string {
  return word.replace(NON_LETTER, "");
}

function isUpperStart(word: string): boolean {
  const letters = lettersOf(word);
  if (!letters) return false;
  const first = letters.charAt(0);
  return first === first.toLocaleUpperCase() && first !== first.toLocaleLowerCase();
}

function isAllUpper(word: string): boolean {
  const letters = lettersOf(word);
  if (!letters) return false;
  return letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
}

function upperFirst(part: string): string {
  return part.charAt(0).toLocaleUpperCase() + part.slice(1);
}

/** Перенести регистр исходного слова на форму из словаря, включая дефисные части. */
function letterCase(source: string, form: string): string {
  if (isAllUpper(source)) return form.toLocaleUpperCase();
  const sourceParts = source.split("-");
  const formParts = form.split("-");
  return formParts
    .map((part, index) => {
      const src = sourceParts[index] ?? sourceParts[sourceParts.length - 1] ?? "";
      return isUpperStart(src) ? upperFirst(part) : part;
    })
    .join("-");
}

function formFor(
  entry: MorphLemmaEntry,
  target: Target,
  gender: string,
  inanimateMasculine: boolean,
): string | null {
  if (entry.p === "N") {
    const slot = target.plural ? 6 + target.caseIndex : target.caseIndex;
    return entry.f[slot] ?? null;
  }
  if (target.plural) return entry.f[18 + target.caseIndex] ?? null;
  // Винительный мужского неодушевлённого совпадает с именительным.
  if (target.caseIndex === 3 && gender === "m" && inanimateMasculine) return entry.f[0] ?? null;
  const genderIndex = gender === "f" ? 1 : gender === "n" ? 2 : 0;
  return entry.f[target.caseIndex * 3 + genderIndex] ?? null;
}

function buildTargets(head: MorphParse): Target[] {
  const targets: Target[] = [];
  // Из множественного числа единственное не строим: «деньги» — не «деньга».
  if (!head.plural) {
    for (let caseIndex = 0; caseIndex < MORPH_CASES.length; caseIndex += 1) {
      if (caseIndex !== head.caseIndex) targets.push({ caseIndex, plural: false });
    }
  }
  for (let caseIndex = 0; caseIndex < MORPH_CASES.length; caseIndex += 1) {
    if (!head.plural || caseIndex !== head.caseIndex) targets.push({ caseIndex, plural: true });
  }
  return targets;
}

/**
 * Написание без «ё»: в переписке пишут и «счёт», и «счет», и значение должно
 * находиться в обоих вариантах.
 */
export function yoeForms(text: string): string[] {
  const plain = text.replace(/ё/g, "е").replace(/Ё/g, "Е");
  return plain === text ? [text] : [text, plain];
}

interface Part {
  text: string;
  word: boolean;
}

function splitParts(value: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of value.matchAll(WORD_RE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: value.slice(last, index), word: false });
    parts.push({ text: match[0], word: true });
    last = index + match[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), word: false });
  return parts;
}

/**
 * Какие слова значения можно склонять.
 *
 * Не склоняем: всё после предлога (падеж задан предлогом) и имена собственные —
 * слова с прописной буквы, кроме самого первого.
 */
function declinableFlags(parts: readonly Part[]): boolean[] {
  const flags = parts.map(() => false);
  let firstSeen = false;
  let stopped = false;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.word) continue;
    const lower = part.text.toLowerCase();
    if (stopped || PREPOSITIONS.has(lower)) {
      stopped = true;
      continue;
    }
    if (firstSeen && isUpperStart(part.text)) continue;
    flags[index] = true;
    firstSeen = true;
  }
  return flags;
}

/** Разбор значения, общий для всех падежных вариантов и для одного падежа. */
interface ValueAnalysis {
  parts: Part[];
  flags: boolean[];
  parses: (MorphParse | undefined)[];
  total: number;
  covered: number;
  unknown: string[];
  head: MorphParse | null;
  gender: string;
  inanimateMasculine: boolean;
}

function analyzeValue(value: string, index: MorphIndex | null): ValueAnalysis | null {
  const text = String(value ?? "");
  const parts = splitParts(text);
  if (!index || parts.length === 0) return null;
  const flags = declinableFlags(parts);
  const parses: (MorphParse | undefined)[] = [];
  const unknown: string[] = [];
  let total = 0;
  let covered = 0;
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    if (!part.word || !flags[partIndex]) {
      parses.push(undefined);
      continue;
    }
    total += 1;
    const parse = pickParse(index.lookup(part.text));
    parses.push(parse);
    if (parse) covered += 1;
    else unknown.push(part.text);
  }
  const head = parses.find((parse) => parse?.pos === "N") ?? null;
  if (!head) {
    return { parts, flags, parses, total, covered, unknown, head: null, gender: "", inanimateMasculine: false };
  }
  const headEntry = index.entry(head.lemma);
  const gender = headEntry && headEntry.p === "N" ? headEntry.g ?? "" : "";
  const inanimateMasculine =
    headEntry && headEntry.p === "N" ? headEntry.f[3] === headEntry.f[0] : false;
  return { parts, flags, parses, total, covered, unknown, head, gender, inanimateMasculine };
}

/** Собрать написание значения в одном падеже; null — если форма неполная. */
function renderTarget(
  analysis: ValueAnalysis,
  target: Target,
  index: MorphIndex,
): string | null {
  const chunks: string[] = [];
  for (let partIndex = 0; partIndex < analysis.parts.length; partIndex += 1) {
    const part = analysis.parts[partIndex];
    const parse = analysis.parses[partIndex];
    if (!part.word || !analysis.flags[partIndex] || !parse) {
      chunks.push(part.text);
      continue;
    }
    const entry = index.entry(parse.lemma);
    const form = entry
      ? formFor(entry, target, analysis.gender, analysis.inanimateMasculine)
      : null;
    if (!form) return null;
    chunks.push(letterCase(part.text, form));
  }
  return chunks.join("").replace(SPACES, " ").trim();
}

/**
 * Падежные написания значения по словарю.
 *
 * Когда словарь не загружен или ведущего существительного в значении нет,
 * возвращается пустой список — вызывающая сторона просто работает на явных
 * `variants`.
 */
export function caseVariants(value: string, index: MorphIndex | null): DeclensionResult {
  const result: DeclensionResult = { variants: [], covered: 0, total: 0, unknown: [] };
  const analysis = analyzeValue(value, index);
  if (!analysis) return result;
  result.covered = analysis.covered;
  result.total = analysis.total;
  result.unknown = analysis.unknown;
  if (!analysis.head || !index) return result;

  const text = String(value ?? "");
  const seen = new Set<string>([text.replace(SPACES, " ").trim().toLowerCase()]);
  for (const target of buildTargets(analysis.head)) {
    const variant = renderTarget(analysis, target, index);
    if (!variant) continue;
    const key = variant.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.variants.push(variant);
  }
  return result;
}

/**
 * Одно написание значения в нужном падеже — для подстановки по контексту.
 *
 * Зачем отдельно от `caseVariants`: там нужен весь набор, чтобы находить
 * значение в тексте при любой форме, а здесь — ровно та форма, которую требует
 * предлог («в ⟦вклад⟧» → «в вклад», «о ⟦вклад⟧» → «о вкладе»).
 * null — словарь не загружен, в значении нет ведущего существительного или
 * парадигма дефектная: тогда вызывающая сторона оставляет канон.
 */
export function declineToCase(
  value: string,
  caseIndex: number,
  plural: boolean,
  index: MorphIndex | null,
): string | null {
  if (!index) return null;
  if (!Number.isInteger(caseIndex) || caseIndex < 0 || caseIndex >= MORPH_CASES.length) {
    return null;
  }
  const analysis = analyzeValue(value, index);
  if (!analysis || !analysis.head) return null;
  return renderTarget(analysis, { caseIndex, plural: plural === true }, index);
}
