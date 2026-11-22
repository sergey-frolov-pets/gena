import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { useAgentFilter } from "./useAgentFilter";

const sessions = ref([
  { id: "s1", agentId: "a1" },
  { id: "s2", agentId: "a2" },
  { id: "s3", agentId: "a1" },
]);
const agents = ref([
  { id: "a1", name: "Первый" },
  { id: "a2", name: "Второй" },
  { id: "a3", name: "Без сессий" },
]);

describe("useAgentFilter", () => {
  it("по умолчанию показывает всё", () => {
    const { filter, filtered } = useAgentFilter(sessions, agents);
    expect(filter.value).toBe("");
    expect(filtered.value.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("в чипах только агенты с записями", () => {
    const { agentsInUse } = useAgentFilter(sessions, agents);
    expect(agentsInUse.value.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("выбор агента оставляет только его записи", () => {
    const { filter, filtered } = useAgentFilter(sessions, agents);
    filter.value = "a1";
    expect(filtered.value.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("исчезнувший агент сбрасывает фильтр на «Все»", async () => {
    const { filter } = useAgentFilter(sessions, agents);
    filter.value = "a2";
    sessions.value = sessions.value.filter((s) => s.agentId !== "a2");
    await nextTick();
    expect(filter.value).toBe("");
  });
});
