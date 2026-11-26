import { describe, expect, it } from "vitest";

import { detectFindings } from "./detect";
import { maskFor, maskText } from "./mask";

function maskAll(text: string) {
  return maskText(text, detectFindings(text));
}

describe("маскирование находок", () => {
  it("прячет сумму и оставляет остальной текст как есть", () => {
    const { text, hidden } = maskAll("на вкладе 1 200 000 ₽, до 2027-03");
    expect(hidden).toBeGreaterThanOrEqual(1);
    expect(text).toContain("[сумма]");
    expect(text).not.toContain("1 200 000");
  });

  it("ограничение по типам оставляет снятый тип открытым", () => {
    const source = "карта 4111 1111 1111 1111, телефон +7 916 123-45-67";
    const findings = detectFindings(source);
    const { text, hidden } = maskText(source, findings, new Set(["card"] as const));
    expect(hidden).toBe(1);
    expect(text).toContain("[карта]");
    expect(text).not.toContain("4111");
    expect(text).toContain("+7 916 123-45-67");
  });

  it("без находок текст не меняется", () => {
    const source = "обычная фраза без цифр и адресов";
    expect(maskAll(source)).toEqual({ text: source, hidden: 0 });
  });

  it("маски идемпотентны: повторный прогон ничего не находит", () => {
    const once = maskAll("счёт 40817 810 0 1234 5678901 и почта test@example.com");
    expect(once.hidden).toBeGreaterThanOrEqual(1);
    expect(maskAll(once.text).hidden).toBe(0);
    expect(maskAll(once.text).text).toBe(once.text);
  });

  it("у каждого типа есть подпись маски", () => {
    for (const label of [maskFor("money"), maskFor("card"), maskFor("account")]) {
      expect(label.startsWith("[")).toBe(true);
      expect(label.endsWith("]")).toBe(true);
    }
  });
});
