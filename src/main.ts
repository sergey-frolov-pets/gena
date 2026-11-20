import { createApp } from "vue";
import App from "./App.vue";
import { vTip } from "./lib/tooltip";
import { vLongPress } from "./lib/longpress";
import { recordError } from "./lib/error-log";
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
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        // Офлайн-режим не критичен — молча пропускаем.
      });
  });
}
