import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/storage/db";
import { clearTokenRecords } from "@/storage/tokens";
import { resetAgentKeyCipherCache } from "@/crypto/agent-key-cipher";
import { resetDeviceStore } from "@/test/device-store";
import { resetTokenCipherCache, openTokenValue, sealTokenValue } from "@/crypto/token-cipher";

describe("crypto/token-cipher", () => {
  beforeEach(() => {
    resetDeviceStore();
    resetAgentKeyCipherCache();
    resetTokenCipherCache();
  });

  it("запечатывает и распечатывает значение", async () => {
    const sealed = await sealTokenValue("1 234 567 ₽", "tok-1");
    expect(sealed.startsWith("enc:tk1:")).toBe(true);
    expect(sealed).not.toContain("1 234 567");
    expect(await openTokenValue(sealed, "tok-1")).toBe("1 234 567 ₽");
  });

  it("чужая запись не расшифровывает значение (additionalData)", async () => {
    const sealed = await sealTokenValue("секрет", "tok-1");
    await expect(openTokenValue(sealed, "tok-2")).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("другой сид устройства — не расшифровать", async () => {
    const sealed = await sealTokenValue("секрет", "tok-1");
    resetDeviceStore();
    resetAgentKeyCipherCache();
    resetTokenCipherCache();
    await expect(openTokenValue(sealed, "tok-1")).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("пустое значение и открытый текст проходят как есть", async () => {
    expect(await sealTokenValue("", "tok-1")).toBe("");
    expect(await openTokenValue("", "tok-1")).toBe("");
    expect(await openTokenValue("просто текст", "tok-1")).toBe("просто текст");
  });
});

describe("lib/tokens/registry", () => {
  beforeEach(async () => {
    await closeDb();
    await clearTokenRecords();
    resetDeviceStore();
    resetAgentKeyCipherCache();
    resetTokenCipherCache();
    // Память модуля между тестами тоже обнуляем: база чистая, а ref — нет.
    const { loadTokens } = await import("./registry");
    await loadTokens();
  });

  it("сохраняет, читает и удаляет записи; значение на диске запечатано", async () => {
    const { loadTokens, saveToken, removeToken, tokenEntries, transferEntries } = await import(
      "./registry"
    );
    const saved = await saveToken({
      name: " Вклад  ВТБ ",
      value: "1 234 567 ₽",
      note: "до 2027-03",
      variants: ["вклада ВТБ", " вклада  ВТБ ", ""],
    });
    expect(saved.name).toBe("Вклад ВТБ");
    expect(saved.variants).toEqual(["вклада ВТБ"]);

    await loadTokens();
    expect(tokenEntries.value).toHaveLength(1);
    expect(tokenEntries.value[0].value).toBe("1 234 567 ₽");
    expect(transferEntries()[0].value).toBe("1 234 567 ₽");

    // В самом сторе значения нет — только конверт.
    const { listTokenRecords } = await import("@/storage/tokens");
    const records = await listTokenRecords();
    expect(records[0].sealedValue.startsWith("enc:tk1:")).toBe(true);
    expect(JSON.stringify(records)).not.toContain("1 234 567");

    await removeToken(saved.id);
    expect(tokenEntries.value).toHaveLength(0);
  });

  it("одно имя дважды не сохраняется", async () => {
    const { saveToken } = await import("./registry");
    await saveToken({ name: "аренда", value: "Квартира" });
    await expect(saveToken({ name: "АРЕНДА", value: "другое" })).rejects.toMatchObject({
      code: "name_duplicate",
    });
  });

  it("пустые имя и значение отвергаются", async () => {
    const { saveToken } = await import("./registry");
    await expect(saveToken({ name: "  ", value: "x" })).rejects.toMatchObject({
      code: "name_required",
    });
    await expect(saveToken({ name: "a", value: "  " })).rejects.toMatchObject({
      code: "value_required",
    });
  });

  it("правка существующей записи сохраняет id", async () => {
    const { saveToken } = await import("./registry");
    const saved = await saveToken({ name: "аренда", value: "Квартира" });
    const edited = await saveToken({ id: saved.id, name: "аренда", value: "Квартира, 15" });
    expect(edited.id).toBe(saved.id);
    expect(edited.createdAt).toBe(saved.createdAt);
  });

  it("чувствительность к регистру — свойство записи, а не диалога", async () => {
    const { loadTokens, saveToken, tokenEntries, transferEntries } = await import("./registry");
    const strict = await saveToken({ name: "ВТБ", value: "ВТБ", caseSensitive: true });
    const plain = await saveToken({ name: "город", value: "Москва" });
    expect(strict.caseSensitive).toBe(true);
    expect(plain.caseSensitive).toBeUndefined();

    await loadTokens();
    const byName = (name: string) => tokenEntries.value.find((entry) => entry.name === name);
    expect(byName("ВТБ")?.caseSensitive).toBe(true);
    expect(byName("город")?.caseSensitive).toBeUndefined();
    // Флаг уезжает вместе с записью в файл переноса.
    expect(transferEntries().find((entry) => entry.name === "ВТБ")?.caseSensitive).toBe(true);

    const { listTokenRecords } = await import("@/storage/tokens");
    const records = await listTokenRecords();
    expect(records.find((record) => record.name === "ВТБ")?.caseSensitive).toBe(true);
    expect(records.find((record) => record.name === "город")?.caseSensitive).toBeUndefined();
  });

  it("флаг записи управляет заменой значений на токены", async () => {
    const { replaceValues, saveToken, loadTokens } = await import("./registry");
    await saveToken({ name: "ВТБ", value: "ВТБ", caseSensitive: true });
    await saveToken({ name: "город", value: "Москва" });
    await loadTokens();
    expect(replaceValues("ВТБ и втб, Москва и москва").text).toBe(
      "⟦ВТБ⟧ и втб, ⟦город⟧ и ⟦город⟧",
    );
  });

  it("импорт: новые добавляются, совпадения заменяются, keep оставляет свои", async () => {
    const { importTokenEntries, loadTokens, saveToken, tokenEntries } = await import("./registry");
    await saveToken({ name: "аренда", value: "старое" });
    const summary = await importTokenEntries([
      { name: "аренда", value: "новое" },
      { name: "вклад ВТБ", value: "1 000 ₽" },
    ]);
    expect(summary).toEqual({ added: 1, replaced: 1, kept: 0 });
    await loadTokens();
    expect(tokenEntries.value.find((entry) => entry.name === "аренда")?.value).toBe("новое");

    const kept = await importTokenEntries([{ name: "аренда", value: "третье" }], () => "keep");
    expect(kept).toEqual({ added: 0, replaced: 0, kept: 1 });
    await loadTokens();
    expect(tokenEntries.value.find((entry) => entry.name === "аренда")?.value).toBe("новое");
  });

  it("replaceValues и restoreValues работают в паре", async () => {
    const { replaceValues, restoreValues, saveToken, loadTokens } = await import("./registry");
    await saveToken({ name: "вклад ВТБ", value: "1 234 567 ₽", variants: ["вклада ВТБ"] });
    await loadTokens();
    const hidden = replaceValues("открытие вклада ВТБ: 1 234 567 ₽");
    expect(hidden.text).toBe("открытие ⟦вклад ВТБ⟧: ⟦вклад ВТБ⟧");
    expect(hidden.hits).toBe(2);
    expect(restoreValues(hidden.text)).toBe("открытие 1 234 567 ₽: 1 234 567 ₽");
  });
});
