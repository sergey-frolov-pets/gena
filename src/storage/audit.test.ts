/**
 * Журнал отправок: пишем метаданные, отдаём свежие первыми, подрезаем до лимита.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { AUDIT_LIMIT, clearAudit, listAudit, recordAudit } from "./audit";
import { getDb } from "./db";

beforeEach(async () => {
  await clearAudit();
});

describe("recordAudit", () => {
  it("пишет запись без содержимого, только метаданные", async () => {
    const entry = await recordAudit({
      agentId: "agent-1",
      sessionId: "sess-1",
      mode: "trusted",
      provider: "api.example.com",
      trusted: true,
      tokens: 3,
      chars: 120,
    });
    expect(entry.id).toMatch(/^audit/);
    expect(entry.tokens).toBe(3);
    expect(Object.keys(entry).sort()).toEqual(
      ["agentId", "chars", "createdAt", "id", "mode", "provider", "sessionId", "tokens", "trusted"].sort(),
    );
  });

  it("отрицательные счётчики поднимаются до нуля", async () => {
    const entry = await recordAudit({
      agentId: "agent-1",
      mode: "tokens",
      provider: "",
      trusted: false,
      tokens: -5,
      chars: -1,
    });
    expect(entry.tokens).toBe(0);
    expect(entry.chars).toBe(0);
  });
});

describe("listAudit", () => {
  it("свежие первыми и не больше запрошенного", async () => {
    for (const provider of ["a.test", "b.test", "c.test"]) {
      await recordAudit({ agentId: "agent-1", mode: "auto", provider, trusted: false });
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordAudit({ agentId: "agent-1", mode: "auto", provider: "d.test", trusted: true });
    const list = await listAudit(2);
    expect(list).toHaveLength(2);
    expect(list[0].provider).toBe("d.test");
    expect(list[1].provider).not.toBe("d.test");
  });
});

describe("лимит журнала", () => {
  it("старые записи удаляются, свежие остаются", async () => {
    for (let i = 0; i < AUDIT_LIMIT + 5; i += 1) {
      await recordAudit({ agentId: `agent-${i}`, mode: "tokens", provider: "x.test", trusted: false });
    }
    const db = await getDb();
    const keys = await db.getAllKeysFromIndex("audit", "by-created-at");
    expect(keys.length).toBeLessThanOrEqual(AUDIT_LIMIT);
    const list = await listAudit(1);
    expect(list[0].agentId).toBe(`agent-${AUDIT_LIMIT + 4}`);
  });
});
