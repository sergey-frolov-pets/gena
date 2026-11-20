/**
 * Новая сборка на сервере: service worker обновился, но вкладка ещё на старой.
 *
 * Без такой плашки пользователь сидит на старом бандле до ручной перезагрузки —
 * а старый клиент может обращаться к тому, чего на сервере уже нет.
 *
 * Тонкость: на первой установке `controller` тоже «появляется», и `controllerchange`
 * срабатывает. Это не обновление — поэтому без прежнего контроллера не подписываемся.
 */

/** Минимальный контракт контейнера service worker (в тестах — фейк). */
export interface UpdateSource {
  controller: unknown;
  addEventListener: (type: "controllerchange", listener: () => void) => void;
}

function container(): UpdateSource | null {
  if (typeof navigator === "undefined") return null;
  const sw = (navigator as { serviceWorker?: UpdateSource }).serviceWorker;
  return sw && typeof sw.addEventListener === "function" ? sw : null;
}

/**
 * Позвать `onReady`, когда управление перейдёт к новой версии service worker.
 * `source` можно подставить в тестах; по умолчанию — `navigator.serviceWorker`.
 */
export function watchForUpdate(onReady: () => void, source: UpdateSource | null = container()): void {
  if (!source) return;
  // Первая установка: контроллера ещё нет, «обновления» тут нет.
  if (!source.controller) return;
  source.addEventListener("controllerchange", () => onReady());
}
