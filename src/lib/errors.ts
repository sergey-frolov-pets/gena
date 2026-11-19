/**
 * Человекочитаемые сообщения об ошибках для UI.
 *
 * Задача — не показывать пользователю «агент ответил 429» или
 * «Failed to fetch», а объяснить, что случилось и что делать.
 */

import { AgentClientError } from "@/lib/agent-client";
import { AgentKeyCipherError } from "@/crypto/agent-key-cipher";

/** Понятный текст для HTTP-статуса ответа агента. */
export function describeStatus(status: number): string {
  if (status === 400) {
    return "Агент отклонил запрос (400). Проверьте формат сообщения и настройки агента.";
  }
  if (status === 401 || status === 403) {
    return "Неверный ключ агента (401/403). Проверьте ключ в разделе «Подключения».";
  }
  if (status === 404) {
    return "Агент не найден по этому адресу (404). Проверьте URL endpoint.";
  }
  if (status === 408) {
    return "Агент не ответил вовремя (408). Попробуйте ещё раз.";
  }
  if (status === 413) {
    return "Слишком большой запрос (413). Уменьшите размер контекста в настройках агента.";
  }
  if (status === 429) {
    return "Лимит запросов на стороне агента (429). Подождите и попробуйте позже.";
  }
  if (status >= 500) {
    return `Агент временно недоступен (${status}). Попробуйте позже.`;
  }
  return `Агент ответил ошибкой ${status}.`;
}

/** Понятный текст для сетевой ошибки fetch (CORS, offline, DNS). */
export function describeNetworkError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("cors") || lower.includes("cross-origin")) {
    return "Браузер заблокировал запрос (CORS). Агент должен разрешить источник этого сайта.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Агент недоступен: нет сети или адрес не отвечает (возможен CORS).";
  }
  if (lower.includes("abort") || lower.includes("timeout")) {
    return "Запрос прерван или истёк таймаут. Попробуйте ещё раз.";
  }
  return `Не удалось связаться с агентом: ${raw}`;
}

/** Понятный текст для ошибки шифрования ключа. */
export function describeCipherError(error: AgentKeyCipherError): string {
  if (error.code === "missing_seed") {
    return "Браузер не сохраняет данные (приватный режим) — ключ нельзя сохранить безопасно.";
  }
  return "Не удалось расшифровать ключ агента. Введите ключ заново в разделе «Подключения».";
}

/** Универсальный маппер: любая ошибка → текст для пользователя. */
export function describeError(error: unknown): string {
  if (error instanceof AgentKeyCipherError) {
    return describeCipherError(error);
  }
  if (error instanceof AgentClientError) {
    if (typeof error.status === "number") {
      return describeStatus(error.status);
    }
    // Без статуса — это сетевая ошибка или не-JSON ответ.
    if (error.message.includes("не-JSON")) {
      return "Агент вернул ответ не в формате JSON. Проверьте, что адрес — это endpoint агента.";
    }
    if (error.message.includes("нет поля reply")) {
      return "Агент ответил, но без поля reply. Проверьте контракт агента.";
    }
    if (error.message.includes("не задан адрес")) {
      return "У агента не задан адрес. Заполните его в разделе «Подключения».";
    }
    return describeNetworkError(new Error(error.message));
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
