/**
 * Фильтр списка по агенту: «Все агенты» + чипы тех, у кого есть записи.
 *
 * Одинаково работает и в истории чата, и на странице сессий — логика одна,
 * компоненты только рисуют.
 */

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

export interface AgentLike {
  id: string;
  name: string;
}

export interface AgentFilter<T extends { agentId: string }> {
  /** Выбранный агент; пусто — все. */
  filter: Ref<string>;
  /** Агенты, у которых есть записи: остальные в фильтре не нужны. */
  agentsInUse: ComputedRef<AgentLike[]>;
  /** Записи после фильтра. */
  filtered: ComputedRef<T[]>;
}

export function useAgentFilter<T extends { agentId: string }>(
  items: Ref<T[]>,
  agents: Ref<AgentLike[]>,
): AgentFilter<T> {
  const filter = ref("");

  const agentsInUse = computed(() =>
    agents.value.filter((agent) => items.value.some((item) => item.agentId === agent.id)),
  );

  const filtered = computed(() =>
    filter.value ? items.value.filter((item) => item.agentId === filter.value) : items.value,
  );

  // Агент пропал из списка (удалили подключение) — возвращаем «Все агенты».
  watch(agentsInUse, (list) => {
    if (filter.value && !list.some((agent) => agent.id === filter.value)) filter.value = "";
  });

  return { filter, agentsInUse, filtered };
}
