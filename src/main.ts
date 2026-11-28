import { createApp } from "vue";
import App from "./App.vue";
import { vTip } from "./lib/tooltip";
import { vLongPress } from "./lib/longpress";
import { recordError } from "./lib/error-log";
import { isBundleStale } from "./lib/bundle-version";
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
   * Сама логика — в `lib/bundle-version.ts`: по ней же `App.vue` решает,
   * нужна ли плашка после `controllerchange`.
   */
  const checkFreshBundle = async (): Promise<void> => {
    if (await isBundleStale()) {
      window.dispatchEvent(new Event("app:update-available"));
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
