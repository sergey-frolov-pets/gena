import { describe, expect, it } from "vitest";
import { describeError, describeNetworkError, describeStatus } from "./errors";
import { AgentClientError } from "./agent-client";
import { AgentKeyCipherError } from "@/crypto/agent-key-cipher";
import { CryptoUnavailableError } from "@/crypto/subtle";
import { translateForLocale } from "@/i18n";

/** Русский переводчик для проверки текстов, как их видит русский пользователь. */
const t = (key: Parameters<typeof translateForLocale>[1], params?: Record<string, string | number>) =>
  translateForLocale("ru", key, params);

describe("describeStatus", () => {
  it("401/403 — про ключ", () => {
    expect(describeStatus(401, t)).toMatch(/ключ/i);
    expect(describeStatus(403, t)).toMatch(/ключ/i);
  });

  it("429 — лимит запросов", () => {
    expect(describeStatus(429, t)).toMatch(/лимит/i);
  });

  it("5xx — временно недоступен", () => {
    expect(describeStatus(500, t)).toMatch(/недоступен/i);
    expect(describeStatus(503, t)).toMatch(/недоступен/i);
  });

  it("404 — адрес", () => {
    expect(describeStatus(404, t)).toMatch(/endpoint|найден/i);
  });

  it("неизвестный статус не падает", () => {
    expect(describeStatus(418, t)).toContain("418");
  });
});

describe("describeNetworkError", () => {
  it("CORS", () => {
    expect(describeNetworkError(new Error("blocked by CORS policy"), t)).toMatch(/CORS/);
  });

  it("Failed to fetch", () => {
    expect(describeNetworkError(new Error("Failed to fetch"), t)).toMatch(/недоступен/i);
  });

  it("timeout", () => {
    expect(describeNetworkError(new Error("request aborted"), t)).toMatch(/прерван|таймаут/i);
  });
});

describe("describeError", () => {
  it("AgentClientError со статусом", () => {
    expect(describeError(new AgentClientError("agent responded 429", 429), t)).toMatch(/лимит/i);
  });

  it("400 с текстом провайдера показывает этот текст", () => {
    expect(
      describeError(
        new AgentClientError("agent responded 400", 400, "openai_error", "roles must alternate"),
        t,
      ),
    ).toContain("roles must alternate");
  });

  it("AgentClientError без статуса — сетевая", () => {
    const msg = describeError(
      new AgentClientError("could not reach", undefined, "network", "Failed to fetch"),
      t,
    );
    expect(msg).toMatch(/недоступен/i);
  });

  it("не-JSON ответ", () => {
    expect(describeError(new AgentClientError("non-json", undefined, "not_json"), t)).toMatch(
      /JSON/,
    );
  });

  it("missing_seed из крипто", () => {
    expect(describeError(new AgentKeyCipherError("missing_seed"), t)).toMatch(/приватн/i);
  });

  it("decrypt_failed из крипто", () => {
    expect(describeError(new AgentKeyCipherError("decrypt_failed"), t)).toMatch(/заново/i);
  });

  it("нет WebCrypto (http) — подсказка про https", () => {
    expect(describeError(new CryptoUnavailableError(), t)).toMatch(/https/i);
  });

  it("обычная ошибка отдаётся как есть", () => {
    expect(describeError(new Error("boom"), t)).toBe("boom");
  });

  it("без переводчика — английский текст", () => {
    expect(describeStatus(401)).toMatch(/key/i);
  });
});
