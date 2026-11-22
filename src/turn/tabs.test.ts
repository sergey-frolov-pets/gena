import { describe, expect, it } from "vitest";
import { closeTab, openTab, readIdList, visibleTabs, writeIdList, type IdListStore } from "./tabs";

function store(initial: Record<string, string> = {}): IdListStore & { writes: string[] } {
  const map = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    writes,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(`${key}=${value}`);
      map.set(key, value);
    },
  };
}

const session = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  updatedAt,
  ...extra,
});

describe("readIdList / writeIdList", () => {
  it("читает список строк", () => {
    expect(readIdList(store({ k: '["a","b"]' }), "k")).toEqual(["a", "b"]);
  });

  it("битый JSON и не-строки отбрасываются", () => {
    expect(readIdList(store({ k: "{oops" }), "k")).toEqual([]);
    expect(readIdList(store({ k: '["a",1,null,"b"]' }), "k")).toEqual(["a", "b"]);
    expect(readIdList(store({ k: '{"a":1}' }), "k")).toEqual([]);
  });

  it("пустое хранилище и исключение чтения — пустой список", () => {
    expect(readIdList(store(), "k")).toEqual([]);
    const broken: IdListStore = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => undefined,
    };
    expect(readIdList(broken, "k")).toEqual([]);
  });

  it("запись не падает при недоступном хранилище", () => {
    const broken: IdListStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeIdList(broken, "k", ["a"])).not.toThrow();
  });
});

describe("openTab", () => {
  it("новая вкладка идёт первой, повторного id нет", () => {
    const next = openTab({ tabIds: ["b", "a"], hiddenIds: [] }, "a");
    expect(next.tabIds).toEqual(["a", "b"]);
  });

  it("снимает вкладку со скрытых", () => {
    const next = openTab({ tabIds: [], hiddenIds: ["a", "b"] }, "a");
    expect(next.hiddenIds).toEqual(["b"]);
  });

  it("держится лимита, вытесняя самую старую", () => {
    const lists = { tabIds: ["a", "b", "c"], hiddenIds: [] };
    const next = openTab(lists, "d", 3);
    expect(next.tabIds).toEqual(["d", "a", "b"]);
  });
});

describe("closeTab", () => {
  it("убирает из полоски и запоминает закрытие", () => {
    const next = closeTab({ tabIds: ["a", "b"], hiddenIds: [] }, "a");
    expect(next.tabIds).toEqual(["b"]);
    expect(next.hiddenIds).toEqual(["a"]);
  });

  it("повторное закрытие не дублирует id", () => {
    const next = closeTab({ tabIds: ["a"], hiddenIds: ["a"] }, "a");
    expect(next.hiddenIds).toEqual(["a"]);
  });
});

describe("visibleTabs", () => {
  const sessions = [session("old", 10), session("mid", 20), session("new", 30)];

  it("порядок: открытые вкладки, активный диалог, свежие", () => {
    expect(visibleTabs(sessions, "old", ["mid"], []).map((s) => s.id)).toEqual([
      "mid",
      "old",
      "new",
    ]);
  });

  it("без активного и открытых — по времени обновления", () => {
    expect(visibleTabs(sessions, null, [], []).map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });

  it("активный диалог не дублируется", () => {
    expect(visibleTabs(sessions, "new", ["new"], []).map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });

  it("закрытые не возвращаются сами", () => {
    expect(visibleTabs(sessions, null, [], ["new"]).map((s) => s.id)).toEqual(["mid", "old"]);
  });

  it("закрытая вкладка активного диалога не возвращается сама", () => {
    // Так было до выноса: снятая вкладка остаётся закрытой, даже если диалог открыт.
    expect(visibleTabs(sessions, "mid", [], ["mid"]).map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("несуществующие id и лимит игнорируются", () => {
    expect(visibleTabs(sessions, "gone", ["gone"], [], 2).map((s) => s.id)).toEqual(["new", "mid"]);
  });

  it("лишние поля диалога сохраняются", () => {
    const list = [{ id: "a", updatedAt: 1, tokenMode: true }];
    expect(visibleTabs(list, null, [], [])[0]?.tokenMode).toBe(true);
  });
});
