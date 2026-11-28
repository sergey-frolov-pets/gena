/**
 * Сверка «моя сборка == сборка на сервере».
 *
 * Между деплоем и перезагрузкой вкладка живёт на старом коде: имя
 * хешированного бандла меняется, а страница об этом не знает. Смотрим
 * свежий `index.html` (no-store) и сравниваем имя файла с тем, что реально
 * исполняется.
 *
 * Модуль нужен в двух местах. `main.ts` по нему решает, показывать ли плашку.
 * `App.vue` — не показывать её лишний раз: `clients.claim()` нового service
 * worker поднимает `controllerchange` уже на обновлённой странице, и это
 * заставляло пользователя «обновиться» второй раз (первый клик плашки и был
 * обновлением).
 */

export interface BundleCheckOptions {
  fetchImpl?: typeof fetch;
  doc?: Document;
  baseUrl?: string;
}

function currentDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

/** Имя исполняемого сейчас бандла: `index-abc123.js` или пустая строка. */
export function currentBundle(doc: Document | null = currentDocument()): string {
  if (!doc) return "";
  const src =
    doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src ?? "";
  return src.split("/").pop() ?? "";
}

/**
 * `true`, если на сервере лежит другая сборка.
 *
 * Сеть недоступна, ответ не ok или на странице нет модульного скрипта —
 * `false`: молча ждём следующей проверки, ложная плашка хуже отсутствия.
 */
export async function isBundleStale(options: BundleCheckOptions = {}): Promise<boolean> {
  const {
    fetchImpl = fetch,
    doc = currentDocument(),
    baseUrl = import.meta.env.BASE_URL,
  } = options;

  const mine = currentBundle(doc);
  if (!mine) return false;

  try {
    const res = await fetchImpl(`${baseUrl}index.html`, { cache: "no-store" });
    if (!res.ok) return false;
    const html = await res.text();
    const fresh = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1] ?? "";
    return Boolean(fresh) && fresh !== mine;
  } catch {
    return false;
  }
}
