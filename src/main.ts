import { createApp } from "vue";
import App from "./App.vue";
import { vTip } from "./lib/tooltip";
import { vLongPress } from "./lib/longpress";
import "./style.css";

createApp(App).directive("tip", vTip).directive("longpress", vLongPress).mount("#app");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        // Офлайн-режим не критичен — молча пропускаем.
      });
  });
}
