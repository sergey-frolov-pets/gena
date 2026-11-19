import { describe, expect, it } from "vitest";
import { describeError, describeNetworkError, describeStatus } from "./errors";
import { AgentClientError } from "./agent-client";
import { AgentKeyCipherError } from "@/crypto/agent-key-cipher";

describe("describeStatus", () => {
  it("401/403 — про ключ", () => {
    expect(describeStatus(401)).toMatch(/ключ/i);
    expect(describeStatus(403)).toMatch(/ключ/i);
  });

  it("429 — лимит запросов", () => {
    expect(describeStatus(429)).toMatch(/лимит/i);
  });

  it("5xx — временно недоступен", () => {
    expect(describeStatus(500)).toMatch(/недоступен/i);
    expect(describeStatus(503)).toMatch(/недоступен/i);
  });

  it("404 — адрес", () => {
    expect(describeStatus(404)).toMatch(/endpoint|найден/i);
  });

  it("неизвестный статус не падает", () => {
    expect(describeStatus(418)).toContain("418");
  });
});

describe("describeNetworkError", () => {
  it("CORS", () => {
    expect(describeNetworkError(new Error("blocked by CORS policy"))).toMatch(/CORS/);
  });

  it("Failed to fetch", () => {
    expect(describeNetworkError(new Error("Failed to fetch"))).toMatch(/недоступен/i);
  });

  it("timeout", () => {
    expect(describeNetworkError(new Error("request aborted"))).toMatch(/прерван|таймаут/i);
  });
});

describe("describeError", () => {
  it("AgentClientError со статусом", () => {
    expect(describeError(new AgentClientError("агент ответил 429", 429))).toMatch(/лимит/i);
  });

  it("AgentClientError без статуса — сетевая", () => {
    const msg = describeError(
      new AgentClientError("не удалось связаться с агентом: Failed to fetch"),
    );
    expect(msg).toMatch(/недоступен/i);
  });

  it("не-JSON ответ", () => {
    expect(describeError(new AgentClientError("агент вернул не-JSON ответ"))).toMatch(/JSON/);
  });

  it("missing_seed из крипто", () => {
    expect(describeError(new AgentKeyCipherError("missing_seed"))).toMatch(/приватн/i);
  });

  it("decrypt_failed из крипто", () => {
    expect(describeError(new AgentKeyCipherError("decrypt_failed"))).toMatch(/заново/i);
  });

  it("обычная ошибка отдаётся как есть", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });
});
