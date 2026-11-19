/**
 * Минимальные типы node-модулей для тестов.
 *
 * В проект не добавлен `@types/node` (он подмешивает node-глобали в браузерный
 * код), а тесты читают фикстуры с диска — объявляем только то, что используем.
 */

declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Uint8Array>;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
