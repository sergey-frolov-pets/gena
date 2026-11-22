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
    expect(parsed.version).toBe(1);
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
    });
    expect(back[1].value).toBe("Квартира на Ленина, 15");
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
});
