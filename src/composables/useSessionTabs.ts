/**
 * Состояние полоски недавних диалогов: порядок вкладок и закрытые человеком.
 *
 * Хранится отдельно от чата, чтобы вкладки переживали перезагрузку, а сам
 * компонент чата не занимался ключами хранилища.
 */

import { ref, computed, type ComputedRef, type Ref } from "vue";
import { TABS_HIDDEN_KEY, TABS_STORAGE_KEY } from "@/turn/draft";
import {
  closeTab,
  openTab,
  readIdList,
  visibleTabs,
  writeIdList,
  type IdListStore,
  type TabLists,
} from "@/turn/tabs";
import type { Session } from "@/storage/types";

export interface SessionTabs {
  /** Что видно в полоске — только существующие диалоги. */
  tabs: ComputedRef<Session[]>;
  /** Открыть диалог: вкладка поднимается наверх, закрытая снова видна. */
  remember: (id: string) => void;
  /** Закрыть вкладку: диалог остаётся в списке и вернётся при открытии. */
  forget: (id: string) => void;
}

/** В приватном режиме доступ к хранилищу бросает исключение — тогда живём без него. */
function browserStore(): IdListStore {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

export function useSessionTabs(
  sessions: Ref<Session[]>,
  activeId: Ref<string | null>,
  storage: IdListStore = browserStore(),
): SessionTabs {
  const tabIds = ref<string[]>(readIdList(storage, TABS_STORAGE_KEY));
  const hiddenIds = ref<string[]>(readIdList(storage, TABS_HIDDEN_KEY));

  function apply(lists: TabLists): void {
    if (lists.tabIds.join("|") === tabIds.value.join("|") &&
        lists.hiddenIds.join("|") === hiddenIds.value.join("|")) {
      return;
    }
    tabIds.value = lists.tabIds;
    hiddenIds.value = lists.hiddenIds;
    writeIdList(storage, TABS_STORAGE_KEY, lists.tabIds);
    writeIdList(storage, TABS_HIDDEN_KEY, lists.hiddenIds);
  }

  const tabs = computed(() =>
    visibleTabs(sessions.value, activeId.value, tabIds.value, hiddenIds.value),
  );

  return {
    tabs,
    remember: (id: string) => apply(openTab({ tabIds: tabIds.value, hiddenIds: hiddenIds.value }, id)),
    forget: (id: string) => apply(closeTab({ tabIds: tabIds.value, hiddenIds: hiddenIds.value }, id)),
  };
}
