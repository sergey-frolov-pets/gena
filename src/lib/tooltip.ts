import type { Directive, DirectiveBinding } from "vue";

/**
 * v-tip="текст" — подсказка для иконочных кнопок.
 *
 * Нативный title на тач-устройствах не показывается вообще, поэтому:
 * - текст кладём в data-tip, рисуем псевдоэлементом (см. style.css);
 * - на pointerdown (тап) добавляем .tip-open на 1600 мс — подсказка
 *   видна и после отпускания пальца;
 * - на hover показывается обычным CSS;
 * - aria-label остаётся у самой кнопки (accessibility).
 */

const OPEN_CLASS = "tip-open";
const VISIBLE_MS = 1600;
/** Приблизительная ширина символа в подсказке (12px, system-ui). */
const CHAR_W = 6.7;
const PADDING_W = 18;
const EDGE = 8;

type TipElement = HTMLElement & { __tipTimer?: number };

function clampToViewport(el: TipElement): void {
  const text = el.dataset.tip ?? "";
  const width = text.length * CHAR_W + PADDING_W;
  const rect = el.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  const maxCenter = window.innerWidth - EDGE - width / 2;
  const minCenter = EDGE + width / 2;
  let shift = 0;
  if (center > maxCenter) shift = maxCenter - center;
  else if (center < minCenter) shift = minCenter - center;
  el.style.setProperty("--tip-shift", `${Math.round(shift)}px`);
}

function show(el: TipElement): void {
  clampToViewport(el);
  el.classList.add(OPEN_CLASS);
  if (el.__tipTimer) window.clearTimeout(el.__tipTimer);
  el.__tipTimer = window.setTimeout(() => {
    el.classList.remove(OPEN_CLASS);
    el.__tipTimer = undefined;
  }, VISIBLE_MS);
}

function onPointerDown(this: TipElement): void {
  show(this);
}

export const vTip: Directive<TipElement, string> = {
  mounted(el, binding: DirectiveBinding<string>) {
    el.dataset.tip = binding.value ?? "";
    el.addEventListener("pointerdown", onPointerDown);
  },
  updated(el, binding: DirectiveBinding<string>) {
    el.dataset.tip = binding.value ?? "";
  },
  unmounted(el) {
    el.removeEventListener("pointerdown", onPointerDown);
    if (el.__tipTimer) window.clearTimeout(el.__tipTimer);
  },
};
