import { afterEach, describe, expect, it, vi } from "vitest";
import { GenaServerClient, GenaServerError, checkGenaServer } from "./gena-server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Собирает запросы, чтобы проверять путь, метод и тело. */
function stubFetch(handler: (url: string, init: RequestInit) => Response): RequestInit[] {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(init);
      return handler(String(input), init);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("клиент доступов", () => {
  it("status() читает роль гостя из /api/server", async () => {
    stubFetch(() =>
      jsonResponse({ name: "Gena", version: "1.1.0", sessions: 2, role: "guest", canManageAccess: false }),
    );
    const status = await new GenaServerClient("http://127.0.0.1:8787", "gac_x").status();
    expect(status.role).toBe("guest");
    expect(status.canManageAccess).toBe(false);
  });

  it("listAccess() у гостя падает с 403, а не отдаёт пустой список", async () => {
    stubFetch(() => jsonResponse({ error: "только владелец" }, 403));
    const client = new GenaServerClient("http://127.0.0.1:8787", "gac_x");
    await expect(client.listAccess()).rejects.toBeInstanceOf(GenaServerError);
  });

  it("createAccess() отправляет подпись и срок, код приходит один раз", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ access: { id: "a1", label: "phone", createdAt: 1 }, code: "gac_new" }, 201),
    );
    const client = new GenaServerClient("http://127.0.0.1:8787", "master");
    const created = await client.createAccess("phone", 1_800_000_000_000);
    expect(created.code).toBe("gac_new");
    expect(JSON.parse(String(calls[0].body))).toEqual({
      label: "phone",
      expiresAt: 1_800_000_000_000,
    });
    expect(calls[0].method).toBe("POST");
  });

  it("deleteAccess() идёт в /api/access/{id} методом DELETE", async () => {
    const calls = stubFetch(() => jsonResponse({ ok: true }));
    const client = new GenaServerClient("http://127.0.0.1:8787", "master");
    await client.deleteAccess("a1");
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("checkGenaServer и роль", () => {
  it("гость по коду: роль guest, управление доступами закрыто", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/health")) {
        return jsonResponse({ ok: true, name: "Gena", version: "1.1.0", sessions: 3 });
      }
      return jsonResponse({ role: "guest", label: "phone", canManageAccess: false });
    });
    const info = await checkGenaServer("http://127.0.0.1:8787", "gac_x");
    expect(info.role).toBe("guest");
    expect(info.canManageAccess).toBe(false);
  });

  it("владелец: роль owner и права на коды", async () => {
    stubFetch((url) =>
      url.endsWith("/api/health")
        ? jsonResponse({ ok: true, name: "Gena", version: "1.1.0", sessions: 0 })
        : jsonResponse({ role: "owner", label: "владелец", canManageAccess: true }),
    );
    const info = await checkGenaServer("http://127.0.0.1:8787", "master");
    expect(info.role).toBe("owner");
    expect(info.canManageAccess).toBe(true);
  });

  it("неверный токен — ошибка проверки, а не тихий «владелец»", async () => {
    stubFetch((url) =>
      url.endsWith("/api/health")
        ? jsonResponse({ ok: true, name: "Gena", version: "1.1.0", sessions: 0 })
        : jsonResponse({ error: "токен не подошёл" }, 401),
    );
    await expect(checkGenaServer("http://127.0.0.1:8787", "wrong")).rejects.toBeInstanceOf(
      GenaServerError,
    );
  });
});
