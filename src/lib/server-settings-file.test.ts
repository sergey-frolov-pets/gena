import { describe, expect, it } from "vitest";
import {
  mergeServers,
  parseServersFile,
  serializeServersJson,
  serializeServersYaml,
  serversFileFrom,
} from "./server-settings-file";
import type { GenaServer } from "@/storage/types";

function server(overrides: Partial<GenaServer> = {}): GenaServer {
  return {
    id: "srv-1",
    name: "Домашний",
    url: "https://gena.example.com",
    sealedToken: "enc:v1:secret",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("файл серверов", () => {
  it("не пишет токен и снимок проверки", () => {
    const file = serversFileFrom([
      server({ lastCheck: { at: 10, name: "Gena", version: "1.2.3", sessions: 4 } }),
    ]);
    const text = serializeServersJson(file);
    expect(text).not.toContain("enc:v1");
    expect(text).not.toContain("sealedToken");
    expect(text).not.toContain("lastCheck");
    expect(file.servers[0]).toMatchObject({ id: "srv-1", name: "Домашний" });
  });

  it("JSON и YAML читаются одинаково", () => {
    const file = serversFileFrom([server(), server({ id: "srv-2", url: "https://b.example.com" })]);
    const fromJson = parseServersFile(serializeServersJson(file));
    const fromYaml = parseServersFile(serializeServersYaml(file));
    expect(fromJson.map((entry) => entry.url)).toEqual([
      "https://gena.example.com",
      "https://b.example.com",
    ]);
    expect(fromYaml).toEqual(fromJson);
  });

  it("принимает голый массив и нормализует адрес", () => {
    const entries = parseServersFile(JSON.stringify([{ url: "gena.example.com/api/" }]));
    expect(entries).toEqual([
      { id: undefined, name: "https://gena.example.com", url: "https://gena.example.com" },
    ]);
  });

  it("отказывает на пустом файле и записи без адреса", () => {
    expect(() => parseServersFile("  ")).toThrow();
    expect(() => parseServersFile(JSON.stringify({ format: "gena-servers" }))).toThrow();
    expect(() => parseServersFile(JSON.stringify([{ name: "без адреса" }]))).toThrow();
  });
});

describe("слияние серверов", () => {
  it("по id сохраняет токен и обновляет имя", () => {
    const current = [server()];
    const merged = mergeServers(current, [{ id: "srv-1", name: "Новое имя", url: "https://gena.example.com" }], 99);
    expect(merged.updated).toBe(1);
    expect(merged.added).toBe(0);
    expect(merged.toWrite[0].sealedToken).toBe("enc:v1:secret");
    expect(merged.toWrite[0].name).toBe("Новое имя");
  });

  it("находит сервер по адресу, даже если адрес записан иначе", () => {
    const current = [server()];
    const merged = mergeServers(
      current,
      [{ name: "Домашний", url: "https://gena.example.com/api" }],
      99,
    );
    expect(merged.updated).toBe(1);
    expect(merged.toWrite[0].id).toBe("srv-1");
    expect(merged.toWrite[0].sealedToken).toBe("enc:v1:secret");
  });

  it("новый сервер создаёт без токена", () => {
    const merged = mergeServers([], [{ name: "Новый", url: "https://new.example.com" }], 99);
    expect(merged.added).toBe(1);
    expect(merged.toWrite[0].sealedToken).toBe("");
    expect(merged.toWrite[0].url).toBe("https://new.example.com");
  });
});
