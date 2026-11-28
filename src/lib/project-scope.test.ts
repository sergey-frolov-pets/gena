import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listServers = vi.fn();
vi.mock("@/storage/db", () => ({ listServers: () => listServers() }));

import { projectScope, resetProjectScopeCache } from "./project-scope";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(handler: (url: string) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  );
}

function server(id: string, name: string) {
  return { id, name, url: `https://${id}.example.com`, token: "gac_x", createdAt: 0, updatedAt: 0 };
}

beforeEach(() => {
  resetProjectScopeCache();
  listServers.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("права на проекты", () => {
  it("серверов нет — управлять можно", async () => {
    listServers.mockResolvedValue([]);
    await expect(projectScope()).resolves.toEqual({ manage: true });
  });

  it("владелец — manage true", async () => {
    listServers.mockResolvedValue([server("a", "Домашний")]);
    stubFetch(() => jsonResponse({ name: "Gena", version: "1.1.0", sessions: 3, role: "owner", canManageAccess: true }));
    await expect(projectScope()).resolves.toEqual({ manage: true });
  });

  it("гость с полным доступом — manage true", async () => {
    listServers.mockResolvedValue([server("a", "Домашний")]);
    stubFetch(() => jsonResponse({ name: "Gena", version: "1.1.0", sessions: 3, role: "guest", canManageAccess: false, scopeAll: true }));
    await expect(projectScope()).resolves.toEqual({ manage: true });
  });

  it("гость с ограничением проектов — manage false и имя сервера", async () => {
    listServers.mockResolvedValue([server("a", "Домашний")]);
    stubFetch(() =>
      jsonResponse({
        name: "Gena",
        version: "1.1.0",
        sessions: 1,
        role: "guest",
        canManageAccess: false,
        scopeAll: false,
        projectScope: ["p1"],
      }),
    );
    await expect(projectScope()).resolves.toEqual({ manage: false, serverName: "Домашний" });
  });

  it("один сервер ограничил — прячем кнопки, даже если второй молчит", async () => {
    listServers.mockResolvedValue([server("a", "Домашний"), server("b", "Рабочий")]);
    stubFetch((url) =>
      url.includes("a.example.com")
        ? jsonResponse({ name: "Gena", version: "1.1.0", sessions: 1, role: "guest", canManageAccess: false, scopeAll: false })
        : jsonResponse({ name: "Gena", version: "1.1.0", sessions: 0, role: "guest", canManageAccess: false, scopeAll: true }),
    );
    const scope = await projectScope();
    expect(scope.manage).toBe(false);
    expect(scope.serverName).toBe("Домашний");
  });

  it("сервер не ответил — не запрещаем", async () => {
    listServers.mockResolvedValue([server("a", "Домашний")]);
    stubFetch(() => jsonResponse({ error: "нет связи" }, 502));
    await expect(projectScope()).resolves.toEqual({ manage: true });
  });

  it("ответ кешируется, force спрашивает заново", async () => {
    listServers.mockResolvedValue([server("a", "Домашний")]);
    const handler = vi.fn(() => jsonResponse({ name: "Gena", version: "1.1.0", sessions: 0, role: "owner", canManageAccess: true }));
    stubFetch(handler);
    await projectScope();
    await projectScope();
    expect(handler).toHaveBeenCalledTimes(1);
    await projectScope(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
