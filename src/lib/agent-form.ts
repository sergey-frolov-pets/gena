/**
 * Валидация формы агента: имя, адрес (http/https или ws/wss), числовые лимиты.
 * Вынесено из `ConnectionsView.vue`, чтобы правила проверялись тестом,
 * а не «на глаз» в шаблоне. Сохранённые значения всегда нормализованы.
 */

import { toCount, type AgentSettings, type Protocol } from "@/storage/types";

export interface AgentFormDraft {
  name: string;
  address: string;
  contextSize: unknown;
  callLimit: unknown;
  llmModel?: string;
}

export type AddressCheck = "ok" | "empty" | "invalid" | "mixed";

export type AgentFormError = "nameEmpty" | "addressEmpty" | "addressInvalid" | "addressMixed";

export interface AgentFormResult {
  ok: boolean;
  errors: AgentFormError[];
  values: {
    name: string;
    address: string;
    settings: AgentSettings;
  };
}

/**
 * Проверить адрес агента.
 * @param protocol  протокол агента (`pico_ws` требует ws/wss)
 * @param raw       строка из формы
 * @param pageProtocol протокол страницы; `https:` запрещает `ws:` (mixed content)
 */
export function checkAddress(
  protocol: Protocol,
  raw: string,
  pageProtocol: string = typeof window === "undefined" ? "" : window.location.protocol,
): AddressCheck {
  const address = String(raw ?? "").trim();
  if (!address) return "empty";

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "invalid";
  }

  if (protocol === "pico_ws") {
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return "invalid";
    if (url.protocol === "ws:" && pageProtocol === "https:") return "mixed";
    return "ok";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid";
  return "ok";
}

/** Полная проверка формы: ошибки списком + нормализованные значения для сохранения. */
export function validateAgentDraft(
  draft: AgentFormDraft,
  options: { protocol: Protocol; pageProtocol?: string },
): AgentFormResult {
  const name = String(draft.name ?? "").trim();
  const address = String(draft.address ?? "").trim();
  const errors: AgentFormError[] = [];

  if (!name) errors.push("nameEmpty");

  const addressCheck = checkAddress(options.protocol, address, options.pageProtocol);
  if (addressCheck === "empty") errors.push("addressEmpty");
  else if (addressCheck === "invalid") errors.push("addressInvalid");
  else if (addressCheck === "mixed") errors.push("addressMixed");

  return {
    ok: errors.length === 0,
    errors,
    values: {
      name,
      address,
      settings: {
        contextSize: toCount(draft.contextSize),
        callLimit: toCount(draft.callLimit),
        llmModel: String(draft.llmModel ?? "").trim(),
      },
    },
  };
}
