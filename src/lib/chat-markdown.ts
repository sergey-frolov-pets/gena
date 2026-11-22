/**
 * Markdown реплики → безопасный HTML.
 *
 * Здесь только подготовка текста сообщения: сам рендерер и санитайзер живут
 * в `lib/markdown`. Отдельный модуль нужен, чтобы лента, живой стрим и
 * компонент пузыря пользовались одной функцией, а не копировали подписи.
 */

import { renderMarkdown, type MarkdownLabels } from "./markdown";
import { splitContent } from "./ui-blocks";

export type { MarkdownLabels };

/** Подписи для рендерера: `t` — функция перевода текущей локали. */
export function markdownLabels(t: (key: never) => string): MarkdownLabels {
  return {
    copy: t("chat.copyMessage" as never),
    tableCopy: t("chat.table.copy" as never),
    tableCsv: t("chat.table.csv" as never),
    tableXlsx: t("chat.table.xlsx" as never),
  };
}

/**
 * P0 контракта плагинов: блок уже находится, рендера ещё нет — один раз
 * пишем в консоль, какой плагин пришёл (или почему блок не принят).
 */
const seenUiBlocks = new Set<string>();

export function noteUiBlock(text: string): void {
  if (!text.includes("```gena-ui")) return;
  if (seenUiBlocks.has(text)) return;
  if (seenUiBlocks.size > 200) seenUiBlocks.clear();
  seenUiBlocks.add(text);
  const parts = splitContent(text);
  console.debug("[gena-ui]", parts.block ? `block:${parts.block.plugin}` : "fallback:text", parts.issues);
}

/** Текст сообщения → HTML с кнопками копирования и скроллом таблиц. */
export function mdHtml(text: string, labels: MarkdownLabels): string {
  noteUiBlock(text);
  return renderMarkdown(text, labels);
}
