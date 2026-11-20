/**
 * Текст сообщения без UI-блока.
 *
 * Единая точка для всех мест, где JSON карточки — лишний шум: копирование,
 * озвучка, экспорт диалога, поиск и история, которая уходит агенту
 * (иначе модель получает собственный JSON и жжёт токены).
 *
 * Не бросает исключений: если разбор не удался — возвращается исходный текст.
 */
import { splitContent } from "@/lib/ui-blocks";

/** `content` → только человеческий текст, без ограждения `gena-ui`. */
export function textOnly(content: string): string {
  if (typeof content !== "string" || !content.trim()) return "";
  try {
    const parts = splitContent(content);
    return parts.block ? parts.text : content;
  } catch {
    return content;
  }
}

/** Есть ли в сообщении принятый UI-блок (для рендера в P1). */
export function hasUiBlock(content: string): boolean {
  if (typeof content !== "string" || !content.trim()) return false;
  try {
    return splitContent(content).block !== null;
  } catch {
    return false;
  }
}
