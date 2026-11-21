import type { Directive, DirectiveBinding } from "vue";

/**
 * v-tip="текст" — подсказка для иконочных кнопок.
 *
 * Нативный title на тач-устройствах не показывается (и дублирует нашу
 * подсказку), псевдоэлемент `::after` режется/перекрывается предками
 * с `transform`/`backdrop-filter`/`overflow`. Поэтому подсказка рисуется
 * отдельным слоем в `body` (`position: fixed`, `#tip-layer`):
 *
 * - тач/перо: долгое нажатие 400 мс → показ + короткая вибрация;
 *   сдвиг пальца > 10 px, pointerup/pointercancel — отмена;
 * - мышь: показ по наведению без задержки, скрытие по уходу;
 * - автозакрытие через 2.2 с, скрытие по scroll/resize;
 * - после долгого нажатия следующий click гасится, чтобы подсказка
 *   не нажимала кнопку;
 * - позиция считается по getBoundingClientRect якоря: снизу, при нехватке
 *   места — сверху, с прижимом к вьюпорту (8 px);
 * - aria-label остаётся у самой кнопки (accessibility).
 */

const LONG_PRESS_MS = 400;
const VISIBLE_MS = 2200;
const MOVE_TOLERANCE = 10;
const EDGE = 8;
const GAP = 8;
const CLICK_GUARD_MS = 700;

type TipElement = HTMLElement & { __tipCleanup?: () => void };

let layer: HTMLDivElement | null = null;
let hideTimer = 0;
let current: TipElement | null = null;
let globalsBound = false;

function ensureLayer(): HTMLDivElement {
  if (layer && layer.isConnected) return layer;
  const el = document.createElement("div");
  el.className = "tip-layer";
  el.id = "tip-layer";
  el.setAttribute("role", "tooltip");
  document.body.appendChild(el);
  layer = el;
  return el;
}

/** Ставит слой над/под якорем и прижимает к вьюпорту. */
function place(anchor: TipElement): void {
  const el = ensureLayer();
  const text = anchor.dataset.tip ?? "";
  if (!text) return;
  el.textContent = text;
  // Меряем размеры до показа: opacity/visibility не влияют на layout.
  el.style.left = "0px";
  el.style.top = "0px";
  const box = el.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = rect.bottom + GAP;
  if (top + box.height > vh - EDGE) {
    const above = rect.top - GAP - box.height;
    top = above >= EDGE ? above : Math.max(EDGE, vh - EDGE - box.height);
  }
  const maxLeft = Math.max(EDGE, vw - EDGE - box.width);
  const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - box.width / 2), maxLeft);

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function show(anchor: TipElement): void {
  const el = ensureLayer();
  current = anchor;
  place(anchor);
  el.classList.add("is-open");
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideTip, VISIBLE_MS);
}

function hideTip(): void {
  window.clearTimeout(hideTimer);
  hideTimer = 0;
  current = null;
  layer?.classList.remove("is-open");
}

function vibrate(): void {
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  try {
    nav.vibrate?.(12);
  } catch {
    // Вибрация может быть запрещена политикой браузера — не критично.
  }
}

/** Один раз на документ: скрытие при скролле/ресайзе и гашение нативного меню. */
function bindGlobals(): void {
  if (globalsBound) return;
  globalsBound = true;
  const onMove = (): void => hideTip();
  window.addEventListener("scroll", onMove, { passive: true, capture: true });
  window.addEventListener("resize", onMove, { passive: true });
  // Долгое нажатие на мобильном вызывает системное меню «Копировать/…» —
  // на иконочных кнопках оно мешает подсказке.
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as Element | null;
    if (target && target.closest("[data-tip]")) e.preventDefault();
  });
}

function attach(el: TipElement): void {
  bindGlobals();

  let pressTimer = 0;
  let guardTimer = 0;
  let startX = 0;
  let startY = 0;
  let suppressClick = false;

  const clearPress = (): void => {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = 0;
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") return;
    clearPress();
    startX = e.clientX;
    startY = e.clientY;
    pressTimer = window.setTimeout(() => {
      pressTimer = 0;
      suppressClick = true;
      window.clearTimeout(guardTimer);
      guardTimer = window.setTimeout(() => {
        suppressClick = false;
      }, CLICK_GUARD_MS);
      vibrate();
      show(el);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!pressTimer) return;
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
      clearPress();
    }
  };

  const onPointerUp = (): void => {
    clearPress();
  };

  const onClickCapture = (e: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerEnter = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") show(el);
  };

  const onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && current === el) hideTip();
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("pointerenter", onPointerEnter);
  el.addEventListener("pointerleave", onPointerLeave);
  el.addEventListener("click", onClickCapture, true);

  el.__tipCleanup = () => {
    clearPress();
    window.clearTimeout(guardTimer);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("pointerenter", onPointerEnter);
    el.removeEventListener("pointerleave", onPointerLeave);
    el.removeEventListener("click", onClickCapture, true);
    if (current === el) hideTip();
  };
}

export const vTip: Directive<TipElement, string> = {
  mounted(el, binding: DirectiveBinding<string>) {
    el.dataset.tip = binding.value ?? "";
    attach(el);
  },
  updated(el, binding: DirectiveBinding<string>) {
    const next = binding.value ?? "";
    el.dataset.tip = next;
    if (current === el && layer?.classList.contains("is-open")) {
      layer.textContent = next;
      place(el);
    }
  },
  unmounted(el) {
    el.__tipCleanup?.();
    delete el.__tipCleanup;
    delete el.dataset.tip;
  },
};
