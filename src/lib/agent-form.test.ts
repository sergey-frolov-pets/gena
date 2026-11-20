import { describe, expect, it } from "vitest";
import { checkAddress, validateAgentDraft } from "./agent-form";

describe("agent-form: адрес", () => {
  it("http/https — валидны для http_json и openai", () => {
    expect(checkAddress("http_json", "https://example.com/api", "https:")).toBe("ok");
    expect(checkAddress("openai", "http://localhost:8080/v1", "http:")).toBe("ok");
  });

  it("для pico_ws нужен ws/wss", () => {
    expect(checkAddress("pico_ws", "wss://example.com/ws", "https:")).toBe("ok");
    expect(checkAddress("pico_ws", "https://example.com/ws", "https:")).toBe("invalid");
  });

  it("ws с https-страницы — mixed content", () => {
    expect(checkAddress("pico_ws", "ws://example.com/ws", "https:")).toBe("mixed");
    expect(checkAddress("pico_ws", "ws://example.com/ws", "http:")).toBe("ok");
  });

  it("мусор, пустая строка и чужие схемы отвергаются", () => {
    expect(checkAddress("http_json", "", "https:")).toBe("empty");
    expect(checkAddress("http_json", "   ", "https:")).toBe("empty");
    expect(checkAddress("http_json", "example.com/api", "https:")).toBe("invalid");
    expect(checkAddress("http_json", "ftp://example.com", "https:")).toBe("invalid");
    expect(checkAddress("http_json", "javascript:alert(1)", "https:")).toBe("invalid");
  });

  it("пробелы по краям не мешают", () => {
    expect(checkAddress("http_json", "  https://example.com  ", "https:")).toBe("ok");
  });
});

describe("agent-form: форма агента", () => {
  it("возвращает нормализованные значения: trim и целые лимиты ≥ 0", () => {
    const result = validateAgentDraft(
      {
        name: "  Рабочий  ",
        address: "  https://example.com/api  ",
        contextSize: "-5",
        callLimit: "12.7",
        llmModel: "  gpt-4o-mini  ",
      },
      { protocol: "http_json", pageProtocol: "https:" },
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({
      name: "Рабочий",
      address: "https://example.com/api",
      settings: { contextSize: 0, callLimit: 13, llmModel: "gpt-4o-mini" },
    });
  });

  it("пустая форма даёт обе ошибки — имя и адрес", () => {
    const result = validateAgentDraft(
      { name: "   ", address: "", contextSize: 20, callLimit: 0 },
      { protocol: "http_json" },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["nameEmpty", "addressEmpty"]);
  });

  it("битый адрес и mixed content дают соответствующие ошибки", () => {
    const broken = validateAgentDraft(
      { name: "Агент", address: "не-url", contextSize: 20, callLimit: 0 },
      { protocol: "http_json" },
    );
    expect(broken.ok).toBe(false);
    expect(broken.errors).toEqual(["addressInvalid"]);

    const mixed = validateAgentDraft(
      { name: "Агент", address: "ws://example.com/ws", contextSize: 20, callLimit: 0 },
      { protocol: "pico_ws", pageProtocol: "https:" },
    );
    expect(mixed.ok).toBe(false);
    expect(mixed.errors).toEqual(["addressMixed"]);
  });

  it("NaN/undefined в лимитах превращаются в 0, а не в мусор", () => {
    const result = validateAgentDraft(
      {
        name: "Агент",
        address: "https://example.com",
        contextSize: NaN,
        callLimit: undefined,
      },
      { protocol: "http_json", pageProtocol: "https:" },
    );

    expect(result.ok).toBe(true);
    expect(result.values.settings.contextSize).toBe(0);
    expect(result.values.settings.callLimit).toBe(0);
  });
});
