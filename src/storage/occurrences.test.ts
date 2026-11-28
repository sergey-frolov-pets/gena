import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/storage/db";
import { resetAgentKeyCipherCache } from "@/crypto/agent-key-cipher";
import { resetDeviceStore } from "@/test/device-store";
import { resetTokenCipherCache } from "@/crypto/token-cipher";
import {
  clearOccurrences,
  clearSessionOccurrences,
  countApplied,
  deleteOccurrence,
  getOccurrence,
  listEntityOccurrences,
  listOccurrences,
  openOccurrenceForm,
  putOccurrence,
  sealOccurrenceForm,
} from "./occurrences";
import type { PrivacyOccurrence } from "./types";

function occurrence(patch: Partial<PrivacyOccurrence> = {}): PrivacyOccurrence {
  return {
    id: "occ-1",
    sessionId: "s1",
    messageId: "m1",
    start: 0,
    end: 6,
    entityId: "tok-1",
    sealedForm: "",
    token: "имя-1",
    status: "applied",
    origin: "auto",
    createdAt: 1,
    ...patch,
  };
}

describe("storage/occurrences", () => {
  beforeEach(async () => {
    await closeDb();
    await clearOccurrences();
    resetDeviceStore();
    resetAgentKeyCipherCache();
    resetTokenCipherCache();
  });

  it("точный текст вхождения на диске запечатан, чтение возвращает его", async () => {
    const sealedForm = await sealOccurrenceForm("Иванов", "occ-1");
    expect(sealedForm).not.toContain("Иванов");
    await putOccurrence(occurrence({ sealedForm }));

    const [saved] = await listOccurrences("s1");
    expect(saved.token).toBe("имя-1");
    expect(JSON.stringify(saved)).not.toContain("Иванов");
    expect(await openOccurrenceForm(saved)).toBe("Иванов");
  });

  it("считает только применённые замены", async () => {
    await putOccurrence(occurrence({ id: "a", status: "applied" }));
    await putOccurrence(occurrence({ id: "b", status: "skipped" }));
    await putOccurrence(occurrence({ id: "c", sessionId: "s2", status: "applied" }));
    expect(await countApplied("s1")).toBe(1);
    expect(await countApplied("s2")).toBe(1);
    expect((await listOccurrences("s1")).length).toBe(2);
  });

  it("ищет по сущности и удаляет вхождения диалога", async () => {
    await putOccurrence(occurrence({ id: "a", entityId: "tok-1" }));
    await putOccurrence(occurrence({ id: "b", entityId: "tok-2" }));
    await putOccurrence(occurrence({ id: "c", sessionId: "s2", entityId: "tok-1" }));
    expect((await listEntityOccurrences("tok-1")).map((item) => item.id).sort()).toEqual(["a", "c"]);

    await clearSessionOccurrences("s1");
    expect(await listOccurrences("s1")).toEqual([]);
    expect((await listOccurrences("s2")).map((item) => item.id)).toEqual(["c"]);
  });

  it("удаляет одно вхождение", async () => {
    await putOccurrence(occurrence());
    expect(await getOccurrence("occ-1")).toBeTruthy();
    await deleteOccurrence("occ-1");
    expect(await getOccurrence("occ-1")).toBeUndefined();
  });
});
