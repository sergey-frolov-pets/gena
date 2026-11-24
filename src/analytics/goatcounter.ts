/**
 * Мост к GoatCounter.
 *
 * Скрипт `count.js` подключается из index.html и появляется не сразу.
 * Пока его нет, события копятся и уходят, как только `window.goatcounter.count`
 * станет функцией. Блокировщик рекламы и выключенная статистика — тишина.
 */

import { isAnalyticsEnabled } from "./config";

export interface GoatCounterCountOptions {
  path: string;
  title?: string;
  event?: boolean;
}

interface GoatCounterApi {
  count?: (options: GoatCounterCountOptions) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounterApi;
  }
}

const pending: GoatCounterCountOptions[] = [];
let flushTimer = 0;
let flushTries = 0;

function api(): GoatCounterApi | null {
  if (typeof window === "undefined") return null;
  const counter = window.goatcounter;
  return counter && typeof counter.count === "function" ? counter : null;
}

function flush(): void {
  const counter = api();
  if (!counter?.count) {
    if (flushTries < 20) {
      flushTries += 1;
      flushTimer = window.setTimeout(flush, 500);
    }
    return;
  }
  flushTries = 0;
  const batch = pending.splice(0, pending.length);
  for (const item of batch) counter.count(item);
}

function send(options: GoatCounterCountOptions): void {
  if (!isAnalyticsEnabled()) return;
  const counter = api();
  if (counter?.count && pending.length === 0) {
    counter.count(options);
    return;
  }
  pending.push(options);
  if (!flushTimer) {
    flushTries = 0;
    flushTimer = window.setTimeout(() => {
      flushTimer = 0;
      flush();
    }, 300);
  }
}

/** Просмотр вкладки. GoatCounter сам добавит страну, язык браузера и экран. */
export function trackPageview(tab: string): void {
  const path = `/${tab.replace(/[^a-z]/g, "") || "chat"}`;
  send({ path, title: path });
}

/** Событие без личных данных: имя — это путь в отчёте Events. */
export function trackEvent(name: string): void {
  send({ path: name, title: name, event: true });
}
