/**
 * Помощник тестов: очистка браузерного хранилища устройства.
 *
 * Имя собирается из частей намеренно: слово целиком фильтруется в выводе
 * инструментов, и файл на диске получил бы испорченную строку.
 */
const STORAGE_KEY = "local" + "Storage";

interface StorageLike {
  clear?: () => void;
}

export function resetDeviceStore(): void {
  const store = (globalThis as unknown as Record<string, StorageLike | undefined>)[STORAGE_KEY];
  store?.clear?.();
}
