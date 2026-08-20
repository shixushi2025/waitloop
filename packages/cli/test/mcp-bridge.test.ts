import { describe, expect, it } from "vitest";

import {
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

  it("explains continuous play and local credential custody during initialize", async () => {
    const response = await handleLocalMcpMessage({
      jsonrpc: "2.0",
      id: "init",
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "init",
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "waitloop-local" },
      },
    });
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("credentials inside the local bridge");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("keep the current Agent run active");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("wait_for_turn");
  });

  it("returns tool errors as MCP tool results", async () => {
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
