import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useSessionTabs } from "./useSessionTabs";
import { TABS_HIDDEN_KEY, TABS_STORAGE_KEY } from "@/turn/draft";
import type { Session } from "@/storage/types";

function session(id: string, updatedAt: number): Session {
  return {
    id,
    agentId: "a1",
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
  };
}

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const sessions = () => ref<Session[]>([session("old", 10), session("mid", 20), session("new", 30)]);

describe("useSessionTabs", () => {
  it("без сохранённого порядка показывает свежие диалоги", () => {
    const tabs = useSessionTabs(sessions(), ref<string | null>(null), memoryStore());
    expect(tabs.tabs.value.map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });

  it("поднимает открытый диалог и сохраняет порядок", () => {
    const storage = memoryStore();
    const tabs = useSessionTabs(sessions(), ref<string | null>(null), storage);
    tabs.remember("old");
    expect(tabs.tabs.value.map((s) => s.id)).toEqual(["old", "new", "mid"]);
    expect(storage.map.get(TABS_STORAGE_KEY)).toBe('["old"]');
  });

  it("закрытие вкладки прячет диалог и запоминается", () => {
    const storage = memoryStore();
    const tabs = useSessionTabs(sessions(), ref<string | null>(null), storage);
    tabs.forget("new");
    expect(tabs.tabs.value.map((s) => s.id)).toEqual(["mid", "old"]);
    expect(storage.map.get(TABS_HIDDEN_KEY)).toBe('["new"]');
  });

  it("повторное открытие закрытой вкладки возвращает её", () => {
    const tabs = useSessionTabs(sessions(), ref<string | null>(null), memoryStore());
    tabs.forget("new");
    tabs.remember("new");
    expect(tabs.tabs.value.map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });

  it("порядок читается из хранилища при старте", () => {
    const tabs = useSessionTabs(
      sessions(),
      ref<string | null>(null),
      memoryStore({ [TABS_STORAGE_KEY]: '["mid","old"]', [TABS_HIDDEN_KEY]: '["new"]' }),
    );
    expect(tabs.tabs.value.map((s) => s.id)).toEqual(["mid", "old"]);
  });

  it("закрытая вкладка активного диалога остаётся закрытой", () => {
    const tabs = useSessionTabs(sessions(), ref<string | null>("new"), memoryStore({
      [TABS_HIDDEN_KEY]: '["new"]',
    }));
    expect(tabs.tabs.value.map((s) => s.id)).toEqual(["mid", "old"]);
  });

  it("битые списки в хранилище не ломают старт", () => {
    const tabs = useSessionTabs(
      sessions(),
      ref<string | null>(null),
      memoryStore({ [TABS_STORAGE_KEY]: "{oops", [TABS_HIDDEN_KEY]: '["mid",7]' }),
    );
    expect(tabs.tabs.value.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("не пишет в хранилище, когда ничего не изменилось", () => {
    let writes = 0;
    const storage = {
      getItem: (key: string) =>
        key === TABS_STORAGE_KEY ? '["mid"]' : '["old"]',
      setItem: () => {
        writes += 1;
      },
    };
    const tabs = useSessionTabs(sessions(), ref<string | null>(null), storage);
    tabs.remember("mid");
    expect(writes).toBe(0);
  });
});
