import { afterEach, describe, expect, it } from "vitest";
import { CryptoUnavailableError, hasSubtleCrypto, requireSubtleCrypto, secureRandom } from "./subtle";

const realSubtle = globalThis.crypto.subtle;

function hideSubtle(): void {
  Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
}

function restoreSubtle(): void {
  Object.defineProperty(globalThis.crypto, "subtle", { value: realSubtle, configurable: true });
}

afterEach(() => {
  restoreSubtle();
});

describe("crypto/subtle", () => {
  it("в обычном окружении WebCrypto есть", () => {
    expect(hasSubtleCrypto()).toBe(true);
    expect(requireSubtleCrypto()).toBe(realSubtle);
  });

  it("без crypto.subtle — понятная ошибка, а не TypeError", () => {
    hideSubtle();
    expect(hasSubtleCrypto()).toBe(false);
    expect(() => requireSubtleCrypto()).toThrow(CryptoUnavailableError);
    try {
      requireSubtleCrypto();
    } catch (error) {
      expect((error as CryptoUnavailableError).code).toBe("insecure_context");
    }
  });

  it("secureRandom отдаёт нужное число байт и проверяет окружение", () => {
    expect(secureRandom(12).length).toBe(12);
    hideSubtle();
    // getRandomValues в http есть, поэтому здесь ошибки нет — проверяем основной путь.
    expect(secureRandom(4).length).toBe(4);
  });
});
