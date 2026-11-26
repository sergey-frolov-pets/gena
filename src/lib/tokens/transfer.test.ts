import { describe, expect, it } from "vitest";
import {
  checkTransferPassword,
  exportTokenFile,
  importTokenFile,
  TransferError,
} from "./transfer";

const entries = [
  {
    name: "вклад ВТБ",
    value: "1 234 567 ₽",
    note: "до 2027-03",
    variants: ["вклада ВТБ", "ВТБ вклад"],
    caseSensitive: true,
  },
  { name: "аренда", value: "Квартира на Ленина, 15" },
];

const password = "k7#Lm2-vQ8!pR4";
const fast = { iterations: 1000 };

describe("tokens/transfer: файл переноса", () => {
  it("экспорт и импорт возвращают те же записи", async () => {
    const file = await exportTokenFile(entries, password, fast);
    const parsed = JSON.parse(file);
    expect(parsed.format).toBe("gena.tokens");
    expect(parsed.version).toBe(2);
    expect(parsed.count).toBe(2);
    expect(parsed.kdf.name).toBe("PBKDF2-SHA256");
    // Значения в файле в открытом виде не лежат.
    expect(file).not.toContain("1 234 567");
    expect(file).not.toContain("Ленина");

    const back = await importTokenFile(file, password);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({
      name: "вклад ВТБ",
      value: "1 234 567 ₽",
      note: "до 2027-03",
      variants: ["вклада ВТБ", "ВТБ вклад"],
      caseSensitive: true,
    });
    expect(back[1].value).toBe("Квартира на Ленина, 15");
    expect(back[1].caseSensitive).toBeUndefined();
  });

  it("неверный пароль — отдельная ошибка", async () => {
    const file = await exportTokenFile(entries, password, fast);
    await expect(importTokenFile(file, "wrong-password-123")).rejects.toMatchObject({
      code: "wrong_password",
    });
  });

  it("битый файл и чужая подпись — bad_file", async () => {
    await expect(importTokenFile("не json", password)).rejects.toMatchObject({ code: "bad_file" });
    await expect(importTokenFile('{"format":"other"}', password)).rejects.toMatchObject({
      code: "bad_file",
    });
  });

  it("неизвестная версия формата отвергается", async () => {
    const file = JSON.parse(await exportTokenFile(entries, password, fast));
    file.version = 99;
    await expect(importTokenFile(JSON.stringify(file), password)).rejects.toMatchObject({
      code: "unsupported_version",
    });
  });

  it("подмена числа итераций ломает расшифровку (AAD привязывает параметры)", async () => {
    const file = JSON.parse(await exportTokenFile(entries, password, fast));
    file.kdf.iterations = 2000;
    await expect(importTokenFile(JSON.stringify(file), password)).rejects.toBeInstanceOf(
      TransferError,
    );
  });

  it("короткий пароль и пустой пароль не проходят", async () => {
    expect(checkTransferPassword("")).toBe("password_required");
    expect(checkTransferPassword("short")).toBe("password_too_short");
    expect(checkTransferPassword(password)).toBeNull();
    await expect(exportTokenFile(entries, "short", fast)).rejects.toMatchObject({
      code: "password_too_short",
    });
  });

  it("нечего экспортировать — no_entries", async () => {
    await expect(exportTokenFile([], password, fast)).rejects.toMatchObject({
      code: "no_entries",
    });
    await expect(
      exportTokenFile([{ name: "пусто", value: "   " }], password, fast),
    ).rejects.toMatchObject({ code: "no_entries" });
  });

  it("кириллица и спецсимволы переживают перенос", async () => {
    const odd = [
      { name: "ключ ЖКХ", value: "№ 12-34/56 — «домофон»; %$#@", note: "лицевой счёт" },
    ];
    const file = await exportTokenFile(odd, password, fast);
    const back = await importTokenFile(file, password);
    expect(back[0].value).toBe("№ 12-34/56 — «домофон»; %$#@");
    expect(back[0].note).toBe("лицевой счёт");
  });

  it("поля v2 (тип, источник, правила) переживают перенос", async () => {
    const v2 = [
      {
        name: "сумма1",
        value: "1 250 000",
        type: "amount" as const,
        source: "auto" as const,
        confidence: 0.93,
        numberMode: "scale" as const,
        allowForAgent: "per-send" as const,
      },
      {
        name: "скидка1",
        value: "25%",
        type: "discount" as const,
        percentHint: "shift" as const,
      },
    ];
    const file = await exportTokenFile(v2, password, fast);
    const back = await importTokenFile(file, password);
    expect(back[0]).toMatchObject({
      type: "amount",
      source: "auto",
      confidence: 0.93,
      numberMode: "scale",
      allowForAgent: "per-send",
    });
    expect(back[1]).toMatchObject({ type: "discount", percentHint: "shift" });
  });

  it("неизвестное значение поля v2 отбрасывается, запись остаётся", async () => {
    const dirty = [
      { name: "компания1", value: "Ромашка", type: "инопланетянин", confidence: 7 },
    ];
    const file = await exportTokenFile(dirty as never, password, fast);
    const back = await importTokenFile(file, password);
    expect(back[0].value).toBe("Ромашка");
    expect(back[0].type).toBeUndefined();
    expect(back[0].confidence).toBeUndefined();
  });

  it("файл версии 1 читается (тип generic, источник user)", async () => {
    const file = await buildV1File([{ name: "старый токен", value: "ООО «Ромашка»" }], password);
    const back = await importTokenFile(file, password);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ name: "старый токен", value: "ООО «Ромашка»" });
    expect(back[0].type).toBeUndefined();
    expect(back[0].source).toBeUndefined();
  });
});

/** Собрать файл формата v1 вручную: проверка обратной совместимости. */
async function buildV1File(payload: unknown[], password: string): Promise<string> {
  const iterations = 1000;
  const encoder = new TextEncoder();
  const toB64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const saltB64 = toB64(salt);
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const body = encoder.encode(
    JSON.stringify({ format: "gena.tokens", version: 1, createdAt: Date.now(), entries: payload }),
  );
  const aad = encoder.encode(
    `gena.tokens|1|PBKDF2-SHA256|${iterations}|${saltB64}`,
  );
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    body,
  );
  return JSON.stringify({
    format: "gena.tokens",
    version: 1,
    createdAt: Date.now(),
    count: payload.length,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: saltB64 },
    cipher: { name: "AES-GCM", iv: toB64(iv) },
    payload: toB64(new Uint8Array(cipher)),
  });
}
