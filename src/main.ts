import { createApp } from "vue";
import App from "./App.vue";
import { vTip } from "./lib/tooltip";
import { vLongPress } from "./lib/longpress";
import { recordError } from "./lib/error-log";
import "./lib/appearance";
import "./style.css";

const app = createApp(App);

/**
 * Глобальный перехват ошибок: пустой экран без объяснений — худший вариант.
 * Пишем в локальный лог (`lib/error-log.ts`) и в консоль, приложение живёт дальше.
 */
app.config.errorHandler = (error, _instance, info) => {
  recordError(error, `vue:${info}`);
  console.error("[gena]", info, error);
};

window.addEventListener("unhandledrejection", (event) => {
  recordError(event.reason, "promise");
  console.error("[gena] unhandled rejection", event.reason);
});

window.addEventListener("error", (event) => {
  recordError(event.error ?? event.message, "window");
});

app.directive("tip", vTip).directive("longpress", vLongPress).mount("#app");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let registration: ServiceWorkerRegistration | null = null;

  /**
   * Принудительная проверка обновления.
   *
   * Браузер сам заглядывает за новым `sw.js` редко (и почти никогда — пока
   * приложение висит в фоне на телефоне), поэтому установленная PWA может
   * месяцами работать на старом бандле: без новых кнопок и без времени хода.
   */
  const checkForUpdate = () => {
    void registration?.update().catch(() => undefined);
  };

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        registration = reg;
        checkForUpdate();
      })
      .catch(() => {
        // Офлайн-режим не критичен — молча пропускаем.
      });
  });

  /**
   * Сверка «моя сборка == сборка на сервере».
   *
   * Между деплоем и перезагрузкой вкладка живёт на старом коде: имя
   * хешированного бандла меняется, а страница об этом не знает. Смотрим
   * свежий index.html (no-store) и сравниваем имя файла с тем, что реально
   * исполняется. Разошлось — показываем плашку «доступна новая версия».
   */
  const currentBundle = (): string => {
    const src =
      document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
        ?.src ?? "";
    return src.split("/").pop() ?? "";
  };
  const checkFreshBundle = async (): Promise<void> => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}index.html`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const html = await res.text();
      const fresh = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1] ?? "";
      const mine = currentBundle();
      if (fresh && mine && fresh !== mine) {
        window.dispatchEvent(new Event("app:update-available"));
      }
    } catch {
      // офлайн или сеть отвалилась — молча, проверим позже
    }
  };
  window.setInterval(() => void checkFreshBundle(), 180_000);
  void checkFreshBundle();

  // Вернулись в приложение — сразу проверяем сборку, не дожидаясь суток.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkForUpdate();
    void checkFreshBundle();
  });
}
