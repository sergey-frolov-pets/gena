import { describe, expect, it, vi } from "vitest";

import type { PrivacyModelSettings } from "@/lib/privacy/model-settings";
import {
  extractJsonBlock,
  parseModelFindings,
  scanWithModel,
} from "@/lib/privacy/model-scan";

const SETTINGS: PrivacyModelSettings = {
  enabled: true,
  address: "http://127.0.0.1:8787",
  model: "scan-model",
  sealedKey: "",
};

const TEXT = "Иванов Иван, тел +7 999 123-45-67";

describe("extractJsonBlock", () => {
  it("снимает markdown-обёртку и лишний текст", () => {
    const raw = 'Вот результат:\n```json\n{"findings":[]}\n```\nГотово';
    expect(extractJsonBlock(raw)).toBe('{"findings":[]}');
  });

  it("без обёртки берёт объект целиком", () => {
    expect(extractJsonBlock(' {"a":1} ')).toBe('{"a":1}');
  });

  it("без объекта — пусто", () => {
    expect(extractJsonBlock("не json")).toBe("");
  });
});

describe("parseModelFindings", () => {
  const personStart = TEXT.indexOf("Иванов Иван");
  const phoneStart = TEXT.indexOf("+7 999");

  it("принимает точные индексы", () => {
    const raw = JSON.stringify({
      findings: [
        { start: personStart, end: personStart + 11, type: "person", text: "Иванов Иван" },
        { start: phoneStart, end: TEXT.length, type: "phone", text: "+7 999 123-45-67" },
      ],
    });
    const findings = parseModelFindings(TEXT, raw);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ start: personStart, type: "person", value: "Иванов Иван" });
    expect(findings[1].type).toBe("phone");
  });

  it("неверные индексы восстанавливает по text", () => {
    const raw = JSON.stringify({
      findings: [{ start: 999, end: 1000, type: "person", text: "Иванов Иван" }],
    });
    const findings = parseModelFindings(TEXT, raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ start: personStart, end: personStart + 11 });
  });

  it("неизвестный тип и мусор отбрасывает", () => {
    const raw = JSON.stringify({
      findings: [
        { start: 0, end: 6, type: "secret", text: "Иванов" },
        { start: "нет", end: 3, type: "person" },
        null,
      ],
    });
    expect(parseModelFindings(TEXT, raw)).toEqual([]);
    expect(parseModelFindings(TEXT, "ломаный json")).toEqual([]);
  });

  it("невалидные индексы с точной подстрокой восстанавливает", () => {
    const raw = JSON.stringify({
      findings: [{ start: "нет", end: 3, type: "person", text: "Ива" }],
    });
    const findings = parseModelFindings(TEXT, raw);
    expect(findings.map((item) => item.start)).toEqual([0, 7]);
  });

  it("перекрытия схлопывает в длиннейший фрагмент", () => {
    const raw = JSON.stringify({
      findings: [
        { start: personStart, end: personStart + 6, type: "person", text: "Иванов" },
        { start: personStart, end: personStart + 11, type: "person", text: "Иванов Иван" },
      ],
    });
    const findings = parseModelFindings(TEXT, raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].end - findings[0].start).toBe(11);
  });
});

describe("scanWithModel", () => {
  it("без настройки — disabled, без сети", async () => {
    const fetchImpl = vi.fn();
    const result = await scanWithModel(TEXT, {
      settings: { ...SETTINGS, enabled: false },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, code: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("разбирает ответ OpenAI-совместимого сервера", async () => {
    const content = JSON.stringify({
      findings: [{ start: 0, end: 11, type: "person", text: "Иванов Иван" }],
    });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await scanWithModel(TEXT, {
      settings: SETTINGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.findings[0].type).toBe("person");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("слишком длинный текст не отправляет", async () => {
    const fetchImpl = vi.fn();
    const result = await scanWithModel("я".repeat(8001), {
      settings: SETTINGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, code: "too_long" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("http-ошибку отдаёт как network", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await scanWithModel(TEXT, {
      settings: SETTINGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, code: "network" });
  });
});
