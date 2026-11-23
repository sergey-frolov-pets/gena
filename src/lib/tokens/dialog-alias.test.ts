import { describe, expect, it } from "vitest";
import {
  aliasByName,
  canRenameInDialog,
  expandDialogAliases,
  upsertAlias,
} from "./dialog-alias";

describe("dialog alias", () => {
  it("новое имя можно задать, пока токена нет в диалоге", () => {
    expect(canRenameInDialog("вклад", [])).toBe(true);
    expect(canRenameInDialog("вклад", ["сумма"])).toBe(true);
    expect(canRenameInDialog("вклад", ["Вклад"])).toBe(false);
  });

  it("локальное имя не затирает источник и раскрывается в имя справочника", () => {
    const aliases = upsertAlias([], "банк", "вклад");
    expect(aliasByName(aliases, "Банк")?.source).toBe("вклад");
    expect(expandDialogAliases("счёт ⟦банк⟧ открыт", aliases)).toBe("счёт ⟦вклад⟧ открыт");
    expect(upsertAlias(aliases, "банк", "банк")).toEqual([]);
  });
});
