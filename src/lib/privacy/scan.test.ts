import { describe, expect, it } from "vitest";

import type { Finding } from "@/lib/privacy/detect";
import { mergeFindings, scanPrivacy } from "@/lib/privacy/scan";

function finding(
  start: number,
  end: number,
  type: Finding["type"],
  confidence: number,
): Finding {
  return { start, end, type, value: "", confidence };
}

describe("mergeFindings", () => {
  it("непересекающиеся находки сохраняет обе", () => {
    const local = [finding(0, 6, "person", 0.6)];
    const remote = [finding(10, 26, "phone", 0.85)];
    expect(mergeFindings(local, remote)).toHaveLength(2);
  });

  it("при пересечении побеждает более уверенная", () => {
    const local = [finding(0, 16, "phone", 0.6)];
    const remote = [finding(0, 11, "person", 0.9)];
    const merged = mergeFindings(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe("person");
  });

  it("при равной уверенности локальная не проигрывает меньшему спану", () => {
    const local = [finding(0, 16, "phone", 0.85)];
    const remote = [finding(0, 11, "person", 0.85)];
    const merged = mergeFindings(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].end).toBe(16);
  });

  it("при равной длине и уверенности побеждает более специфичный тип", () => {
    const local = [finding(0, 4, "money", 0.85)];
    const remote = [finding(0, 4, "card", 0.85)];
    expect(mergeFindings(local, remote)[0].type).toBe("card");
  });

  it("пустые списки — пустой результат", () => {
    expect(mergeFindings([], [])).toEqual([]);
  });
});

describe("scanPrivacy", () => {
  it("model: false — только локальный слой", async () => {
    const outcome = await scanPrivacy("Платёж 1 000 ₽", { model: false });
    expect(outcome.source).toBe("local");
    expect(outcome.findings.some((item) => item.type === "money")).toBe(true);
  });

  it("ненастроенная модель не ломает скан", async () => {
    const outcome = await scanPrivacy("Платёж 1 000 ₽", {
      settings: { enabled: false, address: "", model: "", sealedKey: "" },
    });
    expect(outcome.source).toBe("local");
    expect(outcome.modelError).toBe("disabled");
    expect(outcome.findings.length).toBeGreaterThan(0);
  });
});
