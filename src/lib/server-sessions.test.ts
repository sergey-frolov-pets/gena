/**
 * Регрессия 27.11.2026: переименование серверного диалога не доходило до сервера
 * (синк искал подключение по `serverId` — id сессии на сервере), а название
 * откатывалось к серверному при каждом открытии. Плюс два быстрых тапа по строке
 * списка создавали две локальные копии одного диалога.
 *
 * Здесь проверяем: serverRef заполняется при создании, синк идёт по serverRef,
 * на чужом сервере сессию не создаём, свежее локальное имя не затираем,
 * параллельные открытия дают одну копию.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeDb,
  getSession,
  listSessions,
  putServer,
  putSession,
} from "@/storage/db";
import type { GenaServer, Session } from "@/storage/types";

const clients: Record<
  string,
  {
    get: ReturnType<typeof vi.fn>;
    importSession: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }
> = {};

vi.mock("@/lib/gena-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gena-server")>();
  return {
    ...actual,
    clientFor: async (server: GenaServer) => {
      const client = clients[server.id];
      if (!client) throw new Error(`нет клиента для ${server.id}`);
      return client;
    },
  };
});

const { GenaServerError } = await import("@/lib/gena-server");
const { createServerSession, openServerSession, syncSessionToServer, deleteServerSession, deleteServerSessionsRemote } =
  await import("./server-sessions");

function server(id: string): GenaServer {
  return {
    id,
    name: id,
    url: `https://${id}.example.com`,
    sealedToken: "enc:v1:test",
    createdAt: 1,
    updatedAt: 1,
  };
}

function fakeClient(remote?: {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages?: unknown[];
}) {
  const client = {
    get: vi.fn(async (remoteId: string) => {
      if (!remote || remote.id !== remoteId) {
        throw new GenaServerError("сессия не найдена", 404);
      }
      return {
        session: {
          id: remote.id,
          title: remote.title,
          agentId: "agent-1",
          createdAt: remote.createdAt,
          updatedAt: remote.updatedAt,
        },
        messages: remote.messages ?? [],
      };
    }),
    importSession: vi.fn(async () => ({})),
    remove: vi.fn(async () => undefined),
    create: vi.fn(async (title: string) => ({
      id: "s_created",
      title,
      createdAt: 100,
      updatedAt: 100,
    })),
  };
  return client;
}

describe("server-sessions: переименование и копии", () => {
  beforeEach(async () => {
    await closeDb();
    for (const key of Object.keys(clients)) delete clients[key];
    await putServer(server("srv1"));
    await putServer(server("srv2"));
  });

  it("createServerSession запоминает подключение в serverRef", async () => {
    clients.srv1 = fakeClient();
    const session = await createServerSession("srv1", "Новый диалог", "agent-1");

    expect(session.serverId).toBe("s_created");
    expect(session.serverRef).toBe("srv1");
    expect((await getSession(session.id))?.serverRef).toBe("srv1");
  });

  it("диалог, созданный здесь, помечается инициатором (serverOwned)", async () => {
    clients.srv1 = fakeClient();
    const session = await createServerSession("srv1", "Новый диалог", "agent-1");
    expect(session.serverOwned).toBe(true);
    expect((await getSession(session.id))?.serverOwned).toBe(true);
  });

  it("открытый с сервера диалог инициатором не считается", async () => {
    clients.srv1 = fakeClient({ id: "s_own", title: "Чужой", createdAt: 1, updatedAt: 10 });
    const opened = await openServerSession("srv1", "s_own", "agent-1");
    expect(opened.serverOwned).toBeUndefined();
  });

  it("синк идёт по serverRef, даже если сервер с таким id не первый в списке", async () => {
    clients.srv1 = fakeClient({ id: "s_1", title: "Новый диалог", createdAt: 1, updatedAt: 2 });
    clients.srv2 = fakeClient({ id: "s_1", title: "Новый диалог", createdAt: 1, updatedAt: 2 });

    const session: Session = {
      id: "sess-1",
      agentId: "agent-1",
      title: "Мой диалог",
      createdAt: 1,
      updatedAt: 50,
      messageCount: 0,
      serverId: "s_1",
      serverRef: "srv2",
    };
    await putSession(session);

    expect(await syncSessionToServer("sess-1")).toBe(true);
    expect(clients.srv1.importSession).not.toHaveBeenCalled();
    expect(clients.srv2.importSession).toHaveBeenCalledWith(
      "s_1",
      expect.objectContaining({ title: "Мой диалог" }),
      [],
    );
  });

  it("без serverRef синк находит сервер, где сессия есть, и не создаёт её на чужом", async () => {
    clients.srv1 = fakeClient(); // сессии s_9 здесь нет — 404
    clients.srv2 = fakeClient({ id: "s_9", title: "Новый диалог", createdAt: 1, updatedAt: 2 });

    const session: Session = {
      id: "sess-2",
      agentId: "agent-1",
      title: "Переименованный",
      createdAt: 1,
      updatedAt: 50,
      messageCount: 0,
      serverId: "s_9",
    };
    await putSession(session);

    expect(await syncSessionToServer("sess-2")).toBe(true);
    expect(clients.srv1.importSession).not.toHaveBeenCalled();
    expect(clients.srv2.importSession).toHaveBeenCalledTimes(1);
    expect((await getSession("sess-2"))?.serverRef).toBe("srv2");
  });

  it("локальное имя новее серверного — открытие его не затирает", async () => {
    clients.srv1 = fakeClient({ id: "s_5", title: "Новый диалог", createdAt: 1, updatedAt: 10 });

    const session: Session = {
      id: "sess-5",
      agentId: "agent-1",
      title: "Пенсионный портфель",
      createdAt: 1,
      updatedAt: 99,
      messageCount: 0,
      serverId: "s_5",
      serverRef: "srv1",
    };
    await putSession(session);

    const opened = await openServerSession("srv1", "s_5", "agent-1");
    expect(opened.title).toBe("Пенсионный портфель");
    expect((await getSession("sess-5"))?.title).toBe("Пенсионный портфель");
  });

  it("два параллельных открытия дают одну локальную копию", async () => {
    clients.srv1 = fakeClient({ id: "s_7", title: "Новый диалог", createdAt: 1, updatedAt: 10 });

    const [first, second] = await Promise.all([
      openServerSession("srv1", "s_7", "agent-1"),
      openServerSession("srv1", "s_7", "agent-1"),
    ]);

    expect(first.id).toBe(second.id);
    const copies = (await listSessions()).filter((item) => item.serverId === "s_7");
    expect(copies).toHaveLength(1);
  });
});

describe("server-sessions: удаление с сервера", () => {
  beforeEach(async () => {
    await closeDb();
    for (const key of Object.keys(clients)) delete clients[key];
    await putServer(server("srv1"));
    await putServer(server("srv2"));
  });

  function owned(id: string, remoteId: string, serverRef = "srv1"): Session {
    return {
      id,
      agentId: "agent-1",
      title: "Мой диалог",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
      serverId: remoteId,
      serverRef,
      serverOwned: true,
    };
  }

  it("инициатор удаляет диалог на своём сервере", async () => {
    clients.srv1 = fakeClient();
    const result = await deleteServerSession(owned("s-1", "s_1"));
    expect(result.ok).toBe(true);
    expect(clients.srv1.remove).toHaveBeenCalledWith("s_1");
  });

  it("подключившийся позже в сеть не ходит — чужая переписка остаётся", async () => {
    clients.srv1 = fakeClient();
    const session: Session = {
      id: "s-2",
      agentId: "agent-1",
      title: "Чужой диалог",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
      serverId: "s_2",
      serverRef: "srv1",
    };
    const result = await deleteServerSession(session);
    expect(result.ok).toBe(true);
    expect(clients.srv1.remove).not.toHaveBeenCalled();
  });

  it("404 на сервере — цель достигнута, это не ошибка", async () => {
    clients.srv1 = fakeClient();
    clients.srv1.remove.mockRejectedValueOnce(new GenaServerError("нет такой", 404));
    const result = await deleteServerSession(owned("s-3", "s_3"));
    expect(result.ok).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("сеть отказала — возвращаем причину, чтобы локальную копию не терять", async () => {
    clients.srv1 = fakeClient();
    clients.srv1.remove.mockRejectedValue(new GenaServerError("сервер недоступен", 503));
    clients.srv2 = fakeClient();
    clients.srv2.remove.mockRejectedValue(new GenaServerError("сервер недоступен", 503));
    const result = await deleteServerSession(owned("s-4", "s_4"));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("недоступен");
  });

  it("массовая чистка: отказ сервера из serverRef не мешает — пробуем остальные", async () => {
    clients.srv1 = fakeClient();
    clients.srv2 = fakeClient();
    clients.srv1.remove.mockRejectedValue(new GenaServerError("сервер недоступен", 503));
    const result = await deleteServerSessionsRemote([
      owned("s-5", "s_5", "srv1"),
      { id: "s-7", agentId: "agent-1", title: "Локальный", createdAt: 1, updatedAt: 2, messageCount: 0 },
    ]);
    expect(result.removed).toBe(1);
    expect(result.failed).toBe(0);
    expect(clients.srv2.remove).toHaveBeenCalledWith("s_5");
  });

  it("массовая чистка считает отказы, когда не отвечает ни один сервер", async () => {
    clients.srv1 = fakeClient();
    clients.srv2 = fakeClient();
    clients.srv1.remove.mockRejectedValue(new GenaServerError("сервер недоступен", 503));
    clients.srv2.remove.mockRejectedValue(new GenaServerError("сервер недоступен", 503));
    const result = await deleteServerSessionsRemote([owned("s-6", "s_6", "srv1")]);
    expect(result.removed).toBe(0);
    expect(result.failed).toBe(1);
  });
});
