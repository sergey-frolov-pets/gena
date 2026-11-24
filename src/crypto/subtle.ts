/**
 * Доступность WebCrypto.
 *
 * `crypto.subtle` существует только в защищённом контексте: https или
 * localhost. Если сайт открыт по http (или в WebView без https), браузер
 * отдаёт `undefined`, и любое шифрование падает невнятным TypeError
 * «Cannot read properties of undefined (reading 'encrypt')».
 *
 * Здесь одна проверка на всех: вместо TypeError — понятная ошибка,
 * которую интерфейс переводит в «откройте сайт по https».
 */

/** WebCrypto нет: страница открыта не по https. */
export class CryptoUnavailableError extends Error {
  readonly code = "insecure_context" as const;

  constructor() {
    super("insecure_context");
    this.name = "CryptoUnavailableError";
  }
}

export function hasSubtleCrypto(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

/** WebCrypto или понятная ошибка. Вызывать до любых операций с ключами. */
export function requireSubtleCrypto(): SubtleCrypto {
  if (!hasSubtleCrypto()) throw new CryptoUnavailableError();
  return crypto.subtle;
}

/** Случайные байты (iv, соль, seed) с той же проверкой. */
export function secureRandom(bytes: number): Uint8Array {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new CryptoUnavailableError();
  }
  return crypto.getRandomValues(new Uint8Array(bytes));
}
