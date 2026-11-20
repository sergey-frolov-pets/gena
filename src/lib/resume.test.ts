import { describe, expect, it } from "vitest";
import type { Message } from "@/storage/types";
import { isPendingFresh, PENDING_TTL_MS, shouldResume, type PendingTurn } from "./resume";

const NOW = 1_000_000_000;
const turn = (text = "вопрос", at = NOW - 60_000): PendingTurn => ({
  sessionId: "s1",
  text,
  at,
});

function msg(id: string, role: Message["role"], content = id, kind?: Message["kind"]): Message {
  return { id, sessionId: "s1", role, content, createdAt: 0, kind };
}

describe("незавершённый ход", () => {
  it("свежий ход — моложе TTL", () => {
    expect(isPendingFresh(turn("вопрос", NOW - 1_000), NOW)).toBe(true);
    expect(isPendingFresh(turn("вопрос", NOW - PENDING_TTL_MS + 1), NOW)).toBe(true);
  });

  it("старый ход и ход из будущего не догоняем", () => {
    expect(isPendingFresh(turn("вопрос", NOW - PENDING_TTL_MS), NOW)).toBe(false);
    expect(isPendingFresh(turn("вопрос", NOW + 5_000), NOW)).toBe(false);
    expect(isPendingFresh(turn("вопрос", 0), NOW)).toBe(false);
  });

  it("догоняем, если после реплики нет ответа", () => {
    const list = [
      msg("u1", "user", "раньше"),
      msg("a1", "assistant"),
      msg("u2", "user", "вопрос"),
      msg("t2", "assistant", "мысль", "thought"),
    ];
    expect(shouldResume(list, turn("вопрос"), NOW)).toBe(true);
  });

  it("не догоняем, если ответ уже есть", () => {
    const list = [
      msg("u1", "user", "вопрос"),
      msg("a1", "assistant", "ответ"),
    ];
    expect(shouldResume(list, turn("вопрос"), NOW)).toBe(false);
  });

  it("пустой текст и отсутствие реплики — не догоняем", () => {
    expect(shouldResume([msg("u1", "user", "другое"), msg("a1", "assistant")], turn("вопрос"), NOW)).toBe(
      false,
    );
    expect(shouldResume([msg("u1", "user", "вопрос")], turn("   "), NOW)).toBe(false);
  });

  it("старый ход не догоняется даже без ответа", () => {
    expect(shouldResume([msg("u1", "user", "вопрос")], turn("вопрос", NOW - PENDING_TTL_MS), NOW)).toBe(
      false,
    );
  });
});
