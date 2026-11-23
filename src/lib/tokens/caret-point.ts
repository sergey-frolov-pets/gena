/**
 * Где в поле ввода стоит слово: координаты каретки в пикселях.
 *
 * У textarea нет API «покажи точку символа», поэтому меряем зеркалом:
 * невидимая копия поля с тем же шрифтом и шириной, текст до нужного места
 * и метка. По метке получаем строку и столбец — из них позицию облачка.
 *
 * Модуль только считает: что рисовать и куда ставить, решает экран.
 */

export interface CaretPoint {
  /** Смещение от левого края поля (без рамки). */
  left: number;
  /** Смещение от верха содержимого, с учётом прокрутки поля. */
  top: number;
  /** Высота строки — по ней ставим облачко над словом. */
  lineHeight: number;
}

export interface BubblePlacement {
  left: number;
  top: number;
  /** Места сверху не хватило — облачко ушло под слово. */
  below: boolean;
}

const MIRROR_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "textRendering",
] as const;

/** Координаты каретки внутри textarea. `null` — мерить нечем (нет DOM). */
export function measureCaret(
  area: HTMLTextAreaElement | null,
  offset: number,
): CaretPoint | null {
  if (!area || typeof document === "undefined") return null;
  const width = area.clientWidth;
  if (!width) return null;
  const value = area.value ?? "";
  const at = Math.min(Math.max(Math.trunc(offset) || 0, 0), value.length);

  const mirror = document.createElement("div");
  const style = mirror.style;
  const computed = window.getComputedStyle(area);
  for (const prop of MIRROR_PROPS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (style as any)[prop] = computed[prop as keyof CSSStyleDeclaration] as string;
  }
  style.position = "absolute";
  style.top = "0";
  style.left = "0";
  style.width = `${width}px`;
  style.boxSizing = "border-box";
  style.border = "0";
  style.overflow = "hidden";
  style.whiteSpace = "pre-wrap";
  style.overflowWrap = "anywhere";
  style.wordBreak = "break-word";
  style.visibility = "hidden";
  style.pointerEvents = "none";

  mirror.textContent = value.slice(0, at);
  const marker = document.createElement("span");
  // Неразрывный нулевой символ: у пустой строки метка всё равно имеет место.
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  const tail = document.createElement("span");
  tail.textContent = value.slice(at);
  mirror.appendChild(tail);

  document.body.appendChild(mirror);
  const top = marker.offsetTop - area.scrollTop;
  const left = marker.offsetLeft;
  const lineHeight =
    parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4 || 18;
  mirror.remove();

  if (!Number.isFinite(top) || !Number.isFinite(left)) return null;
  return { left, top, lineHeight };
}

/**
 * Куда поставить облачко: по центру слова, над строкой, в пределах поля.
 *
 * `wordLeft`/`wordTop` — от левого верхнего угла поля ввода (без его рамки).
 */
export function placeBubble(options: {
  wordLeft: number;
  wordTop: number;
  lineHeight: number;
  bubbleWidth: number;
  bubbleHeight: number;
  boxWidth: number;
  /** Запас от края поля, чтобы облачко не липло к рамке. */
  inset?: number;
  /** Расстояние между облачком и строкой. */
  gap?: number;
}): BubblePlacement {
  const inset = options.inset ?? 4;
  const gap = options.gap ?? 6;
  const width = Math.max(0, options.bubbleWidth);
  const maxLeft = Math.max(inset, options.boxWidth - width - inset);
  const centered = options.wordLeft - width / 2;
  const left = Math.min(Math.max(centered, inset), maxLeft);
  const above = options.wordTop - options.bubbleHeight - gap;
  if (above >= inset) return { left, top: above, below: false };
  return {
    left,
    top: options.wordTop + options.lineHeight + gap,
    below: true,
  };
}
