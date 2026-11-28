import { describe, expect, it, vi } from "vitest";
import { currentBundle, isBundleStale } from "./bundle-version";
import { watchForUpdate, type UpdateSource } from "./version-update";

/** Поддельный документ: нужен только `querySelector` за модульным скриптом. */
function doc(src?: string): Document {
  return {
    querySelector: () => (src ? { src } : null),
  } as unknown as Document;
}

/** Поддельный fetch: отдаёт заданный HTML либо падает. */
function fetchHtml(html: string | null): typeof fetch {
  return (async () => {
    if (html === null) throw new Error("offline");
    return { ok: true, text: async () => html } as unknown as Response;
  }) as unknown as typeof fetch;
}

const htmlWith = (bundle: string) =>
  `<html><body><script type="module" src="/assets/${bundle}"></script></body></html>`;

const page = (bundle: string) => doc(`https://gena.example/assets/${bundle}`);

describe("bundle-version: сверка сборки", () => {
  it("берёт имя файла из src модульного скрипта", () => {
    expect(currentBundle(page("index-abc123.js"))).toBe("index-abc123.js");
  });

  it("на странице без модульного скрипта — пустая строка", () => {
    expect(currentBundle(doc())).toBe("");
  });

  it("сборки совпали — не устарела", async () => {
    const stale = await isBundleStale({
      doc: page("index-abc123.js"),
      fetchImpl: fetchHtml(htmlWith("index-abc123.js")),
    });
    expect(stale).toBe(false);
  });

  it("на сервере другой бандл — устарела", async () => {
    const stale = await isBundleStale({
      doc: page("index-old.js"),
      fetchImpl: fetchHtml(htmlWith("index-new.js")),
    });
    expect(stale).toBe(true);
  });

  it("сеть недоступна — не устарела (ложная плашка хуже)", async () => {
    const stale = await isBundleStale({
      doc: page("index-old.js"),
      fetchImpl: fetchHtml(null),
    });
    expect(stale).toBe(false);
  });

  it("нет своего бандла — не устарела и в сеть не идёт", async () => {
    const fetchImpl = vi.fn(fetchHtml(htmlWith("index-new.js")));
    const stale = await isBundleStale({ doc: doc(), fetchImpl });
    expect(stale).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("controllerchange на свежей сборке не поднимает плашку", async () => {
    const listeners: Array<() => void> = [];
    const sw: UpdateSource = {
      controller: { scriptURL: "sw.js" },
      addEventListener: (_type, listener) => listeners.push(listener),
    };
    let updateReady = false;

    watchForUpdate(() => {
      void isBundleStale({
        doc: page("index-abc123.js"),
        fetchImpl: fetchHtml(htmlWith("index-abc123.js")),
      }).then((stale) => {
        if (stale) updateReady = true;
      });
    }, sw);

    listeners.forEach((fn) => fn());
    await vi.waitFor(() => expect(updateReady).toBe(false));
  });

  it("controllerchange на устаревшей сборке плашку поднимает", async () => {
    const listeners: Array<() => void> = [];
    const sw: UpdateSource = {
      controller: { scriptURL: "sw.js" },
      addEventListener: (_type, listener) => listeners.push(listener),
    };
    let updateReady = false;

    watchForUpdate(() => {
      void isBundleStale({
        doc: page("index-old.js"),
        fetchImpl: fetchHtml(htmlWith("index-new.js")),
      }).then((stale) => {
        if (stale) updateReady = true;
      });
    }, sw);

    listeners.forEach((fn) => fn());
    await vi.waitFor(() => expect(updateReady).toBe(true));
  });
});
