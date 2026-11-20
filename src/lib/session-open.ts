/**
 * Когда поднимать последний диалог агента.
 *
 * На холодном старте `loadAgents()` успевает раньше `loadSessions()`: агент уже
 * выбран, а список диалогов ещё пуст. Если открыть диалог в этот момент, лента
 * останется пустой до перезагрузки — поэтому ждём `sessionsLoaded`.
 */

export function shouldOpenLastSession(state: {
  agentId: string | null;
  sessionsLoaded: boolean;
  activeSessionId: string | null;
}): boolean {
  if (!state.agentId) return false;
  if (!state.sessionsLoaded) return false;
  return !state.activeSessionId;
}
