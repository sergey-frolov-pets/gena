/**
 * Падеж значения по контексту ленты.
 *
 * В поле ввода исходная форма помнится точь-в-точь (см. `forms.ts`): человек
 * написал «вклада ВТБ» — снятие токенизации вернёт ровно это. В ленте такой
 * памяти нет и быть не может: сообщение хранится токенами, а значения в него
 * не записываются. Поэтому падеж подбираем по слову перед токеном — обычно это
 * предлог, и он однозначно задаёт падеж: «в ⟦вклад⟧» → «в вклад»,
 * «о ⟦вклад⟧» → «о вкладе», «из ⟦вклад⟧» → «из вклада».
 *
 * Подбор осторожный: контекста нет, словарь не скачан или форма дефектная —
 * остаётся канон записи. Лучше показать именительный падеж, чем выдуманное
 * слово.
 */

import { parseTokens } from "./format";
import { tokenSpans } from "./occurrences";
import { tokensToValues } from "./format";
import { restoreValues } from "./registry";
import { declineValue } from "./morph/service";
import { MORPH_CASES } from "./morph/format";

/** Индекс падежа в порядке файла словаря: nomn, gent, datv, accs, ablt, loct. */
const GENT = MORPH_CASES.indexOf("gent");
const DATV = MORPH_CASES.indexOf("datv");
const ACCS = MORPH_CASES.indexOf("accs");
const ABLT = MORPH_CASES.indexOf("ablt");
const LOCT = MORPH_CASES.indexOf("loct");

/**
 * Предлог → падеж, который он требует.
 *
 * «в»/«на» — винительный: в переписке это чаще направление («вложил в вклад»),
 * а для мужского неодушевлённого винительный совпадает с именительным, так что
 * худшего варианта, чем канон, не получается. «с» — творительный; значение
 * «из» у «с» встречается реже и осталось бы в родительном только угадыванием.
 */
const PREPOSITION_CASE = new Map<string, number>([
  // родительный
  ["из", GENT],
  ["изо", GENT],
  ["от", GENT],
  ["ото", GENT],
  ["до", GENT],
  ["без", GENT],
  ["безо", GENT],
  ["для", GENT],
  ["у", GENT],
  ["около", GENT],
  ["после", GENT],
  ["вокруг", GENT],
  ["кроме", GENT],
  ["ради", GENT],
  ["среди", GENT],
  ["вместо", GENT],
  ["насчёт", GENT],
  ["вследствие", GENT],
  ["против", GENT],
  // дательный
  ["к", DATV],
  ["ко", DATV],
  ["по", DATV],
  ["благодаря", DATV],
  ["согласно", DATV],
  // винительный
  ["в", ACCS],
  ["во", ACCS],
  ["на", ACCS],
  ["за", ACCS],
  ["про", ACCS],
  ["через", ACCS],
  ["сквозь", ACCS],
  // творительный
  ["с", ABLT],
  ["со", ABLT],
  ["над", ABLT],
  ["надо", ABLT],
  ["перед", ABLT],
  ["передо", ABLT],
  ["между", ABLT],
  ["под", ABLT],
  ["подо", ABLT],
  // предложный
  ["о", LOCT],
  ["об", LOCT],
  ["обо", LOCT],
  ["при", LOCT],
]);

/** Последнее слово текста: «вложил в» → «в». */
function lastWord(before: string): string {
  const tail = String(before ?? "").match(/[\p{L}][\p{L}-]*\s*$/u);
  return tail ? tail[0].trim().toLocaleLowerCase() : "";
}

/** Падеж, который задаёт предлог прямо перед токеном. */
export function caseAfterPreposition(
  before: string,
): { caseIndex: number; plural: boolean } | null {
  const word = lastWord(before);
  if (!word) return null;
  const caseIndex = PREPOSITION_CASE.get(word);
  if (caseIndex === undefined) return null;
  return { caseIndex, plural: false };
}

/** Значение в падеже по контексту; канон, если падеж не определить. */
export function declineWithContext(before: string, value: string): string {
  const target = caseAfterPreposition(before);
  if (!target) return value;
  const declined = declineValue(value, target.caseIndex, target.plural);
  return declined && declined.trim() ? declined : value;
}

/**
 * Токены → значения с падежом по контексту (для ленты сообщений).
 *
 * Идём слева направо и смотрим на уже собранный текст перед токеном: там и
 * лежит предлог. Неизвестное имя токена остаётся как есть — текст не теряется.
 */
export function restoreValuesWithCase(
  text: string,
  lookup?: (name: string) => string | undefined,
): string {
  const source = String(text ?? "");
  if (!source.includes("⟦")) return source;
  let out = "";
  let from = 0;
  for (const span of tokenSpans(source)) {
    out += source.slice(from, span.start);
    const raw = source.slice(span.start, span.end);
    const canon = lookup ? tokensToValues(raw, lookup) : restoreValues(raw);
    out += canon === raw ? raw : declineWithContext(out, canon);
    from = span.end;
  }
  return out + source.slice(from);
}

/**
 * Форма каждого токена так, как её показала бы лента.
 *
 * Перенос реплики в поле ввода не должен схлопывать все ⟦я⟧ в канон записи:
 * у каждого вхождения свой падеж по предлогу перед ним. Нет падежа — канон.
 * Неизвестный токен даёт пустую строку: подставлять вместо него нечего.
 */
export function contextForms(text: string): string[] {
  const source = String(text ?? "");
  const forms: string[] = [];
  let shown = "";
  let from = 0;
  for (const token of parseTokens(source)) {
    shown += source.slice(from, token.start);
    const canon = restoreValues(token.raw);
    if (canon === token.raw) {
      forms.push("");
      shown += token.raw;
    } else {
      const form = declineWithContext(shown, canon);
      forms.push(form);
      shown += form;
    }
    from = token.end;
  }
  return forms;
}
