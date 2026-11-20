import type { Directive, DirectiveBinding } from "vue";

/**
 * v-longpress="обработчик" — действие по долгому нажатию.
 *
 * Нужно там, где текст обрезан (`text-overflow: ellipsis`) и прочитать его
 * целиком иначе нельзя: долгий тап по названию диалога открывает модалку
 * с полным названием.
 *
 * - 450 мс удержания; сдвиг пальца/мыши больше 10 px — отмена (это скролл);
 * - после срабатывания следующий click гасится, чтобы не открыть диалог
 *   и не запустить переименование;
 * - работает и мышью (удобно проверять на десктопе), только левой кнопкой;
 * - короткая вибрация на тач-устройствах, как у `v-tip`.
 */

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;
const CLICK_GUARD_MS = 700;

type PressElement = HTMLElement & {
  __pressHandler?: () => void;
  __pressCleanup?: () => void;
};

function vibrate(): void {
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  try {
    nav.vibrate?.(12);
  } catch {
    // Вибрация может быть запрещена политикой браузера — не критично.
  }
}

export const vLongPress: Directive<PressElement, (() => void) | undefined> = {
  mounted(el, binding: DirectiveBinding<(() => void) | undefined>) {
    el.__pressHandler = typeof binding.value === "function" ? binding.value : undefined;

    let pressTimer = 0;
    let guardTimer = 0;
    let startX = 0;
    let startY = 0;
    let fired = false;

    const clearPress = (): void => {
      if (!pressTimer) return;
      window.clearTimeout(pressTimer);
      pressTimer = 0;
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      clearPress();
      fired = false;
      startX = event.clientX;
      startY = event.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
        fired = true;
        window.clearTimeout(guardTimer);
        guardTimer = window.setTimeout(() => {
          fired = false;
        }, CLICK_GUARD_MS);
        vibrate();
        el.__pressHandler?.();
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!pressTimer) return;
      if (
        Math.abs(event.clientX - startX) > MOVE_TOLERANCE ||
        Math.abs(event.clientY - startY) > MOVE_TOLERANCE
      ) {
        clearPress();
      }
    };

    const onPointerUp = (): void => clearPress();

    const onClickCapture = (event: MouseEvent): void => {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopPropagation();
    };

    // Долгое нажатие на мобильном поднимает системное меню «Копировать/…».
    const onContextMenu = (event: Event): void => {
      if (pressTimer || fired) event.preventDefault();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("contextmenu", onContextMenu);

    el.__pressCleanup = () => {
      clearPress();
      window.clearTimeout(guardTimer);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  },
  updated(el, binding: DirectiveBinding<(() => void) | undefined>) {
    el.__pressHandler = typeof binding.value === "function" ? binding.value : undefined;
  },
  unmounted(el) {
    el.__pressCleanup?.();
    delete el.__pressCleanup;
    delete el.__pressHandler;
  },
};
