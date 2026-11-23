/**
 * Имя токена только для текущего диалога.
 *
 * Жёлтое значение из справочника можно закрыть другим именем, не переписывая
 * саму запись: справочник остаётся прежним, а новое имя живёт в этом диалоге.
 * Если токен уже стоит в диалоге, имя не меняем — значение уже выбрано.
 */

import { formatToken, parseTokens, tokenNameKey } from "./format";

export interface DialogAlias {
  /** Имя, которое видно в этом диалоге. */
  name: string;
  /** Имя записи справочника, чьё значение подставляется. */
  source: string;
}

/** Токен с таким именем уже есть в диалоге — новое имя задавать нельзя. */
export function canRenameInDialog(sourceName: string, usedNames: readonly string[]): boolean {
  const key = tokenNameKey(sourceName);
  if (!key) return false;
  return !usedNames.some((name) => tokenNameKey(name) === key);
}

export function aliasByName(
  aliases: readonly DialogAlias[],
  name: string,
): DialogAlias | undefined {
  const key = tokenNameKey(name);
  if (!key) return undefined;
  return aliases.find((alias) => tokenNameKey(alias.name) === key);
}

/** Добавить или заменить локальное имя. Пустые и совпадающие с источником отбрасываем. */
export function upsertAlias(
  aliases: readonly DialogAlias[],
  name: string,
  source: string,
): DialogAlias[] {
  const nextName = name.trim();
  const nextSource = source.trim();
  if (!tokenNameKey(nextName) || !tokenNameKey(nextSource)) return [...aliases];
  if (tokenNameKey(nextName) === tokenNameKey(nextSource)) {
    return aliases.filter((alias) => tokenNameKey(alias.name) !== tokenNameKey(nextName));
  }
  const rest = aliases.filter((alias) => tokenNameKey(alias.name) !== tokenNameKey(nextName));
  return [...rest, { name: nextName, source: nextSource }];
}

/**
 * Локальные имена → имена справочника.
 *
 * Нужно перед расшифровкой, которая знает только справочник: ⟦банк⟧ становится
 * ⟦вклад⟧, а запись справочника не трогается.
 */
export function expandDialogAliases(text: string, aliases: readonly DialogAlias[]): string {
  const source = String(text ?? "");
  if (!source || aliases.length === 0) return source;
  const tokens = parseTokens(source);
  if (tokens.length === 0) return source;
  let out = "";
  let from = 0;
  for (const token of tokens) {
    out += source.slice(from, token.start);
    const alias = aliasByName(aliases, token.name);
    out += alias ? formatToken(alias.source) : token.raw;
    from = token.end;
  }
  return out + source.slice(from);
}
