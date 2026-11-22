import { describe, expect, it } from "vitest";
import { findConflicts, planMerge } from "./merge";

const existing = [
  { name: "Вклад ВТБ", updatedAt: 1 },
  { name: "аренда", updatedAt: 2 },
];

const incoming = [
  { name: "вклад втб", value: "новое значение" },
  { name: "новая запись", value: "значение" },
  { name: "АРЕНДА", value: "другое значение" },
];

describe("tokens/merge", () => {
  it("совпадения ищутся без учёта регистра", () => {
    const conflicts = findConflicts(existing, incoming);
    expect(conflicts.map((item) => item.nameKey).sort()).toEqual(["аренда", "вклад втб"]);
  });

  it("по умолчанию совпавшие записи заменяются файлом", () => {
    const plan = planMerge(existing, incoming);
    expect(plan.write.map((entry) => entry.name)).toEqual(["вклад втб", "новая запись", "АРЕНДА"]);
    expect(plan.kept).toEqual([]);
  });

  it("политика keep оставляет свои записи", () => {
    const plan = planMerge(existing, incoming, () => "keep");
    expect(plan.write.map((entry) => entry.name)).toEqual(["новая запись"]);
    expect(plan.kept).toEqual(["вклад втб", "АРЕНДА"]);
  });

  it("решение принимается по каждой записи", () => {
    const plan = planMerge(existing, incoming, (conflict) =>
      conflict.nameKey === "аренда" ? "keep" : "replace",
    );
    expect(plan.write.map((entry) => entry.name)).toEqual(["вклад втб", "новая запись"]);
    expect(plan.kept).toEqual(["АРЕНДА"]);
  });

  it("дубли внутри файла берутся один раз", () => {
    const plan = planMerge([], [
      { name: "Ар", value: "1" },
      { name: "ар", value: "2" },
    ]);
    expect(plan.write).toHaveLength(1);
    expect(plan.write[0].value).toBe("1");
  });

  it("пустой справочник — все записи новые", () => {
    const plan = planMerge([], incoming);
    expect(plan.conflicts).toEqual([]);
    expect(plan.write).toHaveLength(3);
  });
});
