/**
 * Состояние хранилища для интерфейса.
 *
 * Отдельный модуль, потому что ошибку открытия базы надо показать в шапке,
 * а не оставить пустые списки без объяснений: «пропали агенты и диалоги»
 * и «база не открылась» выглядят одинаково, а чинятся по-разному.
 */

import { ref } from "vue";
import { StorageBlockedError } from "@/storage/db";

/** `""` — всё в порядке; иначе причина, по которой данные не прочитаны. */
export const storageError = ref<"" | "blocked" | "failed">("");

/** Была восстановлена локальная копия — показываем строку и дату. */
export const storageNotice = ref<{ at: number } | null>(null);

export function describeStorageFailure(error: unknown): "blocked" | "failed" {
  if (error instanceof StorageBlockedError) return "blocked";
  const name = (error as { name?: string } | null)?.name;
  return name === "StorageBlockedError" ? "blocked" : "failed";
}
