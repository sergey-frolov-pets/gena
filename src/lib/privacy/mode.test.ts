import { describe, expect, it } from "vitest";

import {
    isLegacyPrivacy,
    isTrustedProvider,
    normalizeTrustedProviders,
    privacyBadge,
    providerHost,
    resolvePrivacyMode,
} from "./mode";

describe("resolvePrivacyMode", () => {
  it("старый флаг сильнее нового поля", () => {
    expect(resolvePrivacyMode({ tokenOnly: true, privacy: "trusted" })).toBe("tokens");
    expect(resolvePrivacyMode({ privacy: "tokens" })).toBe("tokens");
  });

  it("нет поля — режим совместимости", () => {
    expect(resolvePrivacyMode({})).toBe("trusted");
    expect(resolvePrivacyMode(null)).toBe("trusted");
    expect(resolvePrivacyMode(undefined)).toBe("trusted");
  });

  it("мусор в поле читается как совместимость", () => {
    expect(resolvePrivacyMode({ privacy: "что-то" as never })).toBe("trusted");
  });

  it("старой записью считается только отсутствие поля", () => {
    expect(isLegacyPrivacy({})).toBe(true);
    expect(isLegacyPrivacy({ privacy: "auto" })).toBe(false);
  });
});

describe("providerHost", () => {
  it("понимает адрес со схемой и без", () => {
    expect(providerHost("https://API.Example.com/v1/chat")).toBe("api.example.com");
    expect(providerHost("api.example.com")).toBe("api.example.com");
    expect(providerHost("wss://agent.example.com/ws")).toBe("agent.example.com");
  });

  it("пустой и битый адрес дают пустую строку", () => {
    expect(providerHost("")).toBe("");
    expect(providerHost(undefined)).toBe("");
    expect(providerHost("   ")).toBe("");
  });
});

describe("isTrustedProvider", () => {
  const trust = ["api.example.com", ".corp.example", "*.nested.test"];

  it("точный хост", () => {
    expect(isTrustedProvider("https://api.example.com", trust)).toBe(true);
    expect(isTrustedProvider("https://api.example.org", trust)).toBe(false);
  });

  it("поддомены по точке и звёздочке", () => {
    expect(isTrustedProvider("https://llm.corp.example", trust)).toBe(true);
    expect(isTrustedProvider("https://corp.example", trust)).toBe(true);
    expect(isTrustedProvider("https://a.b.nested.test", trust)).toBe(true);
    expect(isTrustedProvider("https://nested.test", trust)).toBe(true);
    expect(isTrustedProvider("https://evilcorp.example", trust)).toBe(false);
  });

  it("пустой список и пустой адрес — не доверенные", () => {
    expect(isTrustedProvider("https://api.example.com", [])).toBe(false);
    expect(isTrustedProvider("", trust)).toBe(false);
  });
});

describe("normalizeTrustedProviders", () => {
  it("чистит пробелы, регистр и дубли", () => {
    expect(normalizeTrustedProviders([" API.Example.com ", "", "api.example.com", ".Corp.Example"]))
      .toEqual(["api.example.com", ".corp.example"]);
  });
});

describe("privacyBadge", () => {
  const trust = ["api.example.com"];

  it("режимы и совместимость", () => {
    expect(privacyBadge({ privacy: "tokens", address: "https://api.example.com" }, trust)).toBe("tokens");
    expect(privacyBadge({ privacy: "trusted", address: "https://api.example.com" }, trust)).toBe("trusted");
    expect(privacyBadge({ privacy: "auto", address: "https://api.example.com" }, trust)).toBe("auto");
    expect(privacyBadge({ privacy: "trusted", address: "https://other.test" }, trust)).toBe("untrusted");
    expect(privacyBadge({ address: "https://api.example.com" }, trust)).toBe("legacy");
  });
});
