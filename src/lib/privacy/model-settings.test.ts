import { describe, expect, it } from "vitest";

import {
  isPrivacyModelReady,
  normalizePrivacyAddress,
  privacyChatUrl,
} from "@/lib/privacy/model-settings";

describe("normalizePrivacyAddress", () => {
  it("убирает пробелы и хвостовой слэш", () => {
    expect(normalizePrivacyAddress("  http://127.0.0.1:8787/  ")).toBe("http://127.0.0.1:8787");
    expect(normalizePrivacyAddress("https://llm.local/v1///")).toBe("https://llm.local/v1");
  });

  it("без схемы и с чужой схемой — пусто", () => {
    expect(normalizePrivacyAddress("127.0.0.1:8787")).toBe("");
    expect(normalizePrivacyAddress("ftp://host")).toBe("");
    expect(normalizePrivacyAddress("   ")).toBe("");
  });
});

describe("privacyChatUrl", () => {
  it("добавляет /v1/chat/completions", () => {
    expect(privacyChatUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/v1/chat/completions",
    );
  });

  it("не дублирует /v1", () => {
    expect(privacyChatUrl("http://127.0.0.1:8787/v1")).toBe(
      "http://127.0.0.1:8787/v1/chat/completions",
    );
  });

  it("пустой адрес — пустая строка", () => {
    expect(privacyChatUrl("")).toBe("");
  });
});

describe("isPrivacyModelReady", () => {
  const base = { enabled: true, address: "http://host:1", model: "m", sealedKey: "" };

  it("готово только когда включено и заполнены адрес и модель", () => {
    expect(isPrivacyModelReady(base)).toBe(true);
    expect(isPrivacyModelReady({ ...base, enabled: false })).toBe(false);
    expect(isPrivacyModelReady({ ...base, address: "" })).toBe(false);
    expect(isPrivacyModelReady({ ...base, model: "  " })).toBe(false);
  });
});
