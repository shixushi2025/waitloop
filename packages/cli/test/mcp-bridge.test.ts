import { describe, expect, it } from "vitest";

import {
  createLocalMcpDispatcher,
  handleLocalMcpMessage,
  LOCAL_MCP_INSTRUCTIONS,
  LOCAL_MCP_TOOLS,
} from "../src/mcp-bridge.js";

describe("stable local MCP bridge", () => {
  it("advertises control and gameplay tools without exposing credentials", async () => {
    const response = await handleLocalMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const names = LOCAL_MCP_TOOLS.map((tool) => tool.name);

    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(names).toEqual([
      "create_room",
      "join_room",
      "get_active_room",
      "leave_room",
      "get_turn",
      "wait_for_turn",
      "play_move",
      "comment",
      "yield_to_bot",
      "take_control",
    ]);
    expect(JSON.stringify(response)).not.toContain("wlseat_");
  });

  it("supports modern discovery and legacy initialize from the same stdio surface", async () => {
    const modern = await handleLocalMcpMessage({
      jsonrpc: "2.0",
      id: "discover",
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    expect(modern).toMatchObject({
      jsonrpc: "2.0",
      id: "discover",
      result: {
        supportedVersions: ["2026-07-28"],
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "waitloop-local" } },
      },
    });

    const legacy = await handleLocalMcpMessage({
      jsonrpc: "2.0",
      id: "init",
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(legacy).toMatchObject({
      jsonrpc: "2.0",
      id: "init",
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "waitloop-local" },
      },
    });
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("credentials inside the local bridge");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("wait_for_turn");
  });

  it("cancels an in-flight request without emitting its stale result", async () => {
    const writes: Record<string, unknown>[] = [];
    let sawAbort = false;
    const dispatcher = createLocalMcpDispatcher(
      async (response) => { writes.push(response); },
      async (message, signal) => {
        const request = message as { id?: unknown };
        if (request.id !== 7) return null;
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => {
            sawAbort = true;
            resolve();
          }, { once: true });
        });
        return { jsonrpc: "2.0", id: 7, result: { stale: true } };
      },
    );

    dispatcher.start({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "wait_for_turn", arguments: {} } });
    dispatcher.start({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7, reason: "test" } });
    await dispatcher.waitForIdle();

    expect(sawAbort).toBe(true);
    expect(writes).toEqual([]);
  });

  it("returns structured tool errors", async () => {
    const response = await handleLocalMcpMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "not_a_tool", arguments: {} },
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: { isError: true },
    });
  });
});
