import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import {
  createLocalMcpServer,
  localToolError,
  LOCAL_MCP_INSTRUCTIONS,
  LOCAL_MCP_TOOLS,
} from "../src/mcp-bridge.js";
import { WaitloopClientError } from "../src/room-client.js";

describe("stable local MCP bridge", () => {
  it("registers the stable tool contract without exposing credentials", () => {
    const names = LOCAL_MCP_TOOLS.map((tool) => tool.name);
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
    expect(JSON.stringify(LOCAL_MCP_TOOLS)).not.toContain("wlseat_");
    expect(createLocalMcpServer()).toBeInstanceOf(McpServer);
  });

  it("explains credential custody, continuous play, and cancellation", () => {
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("credentials inside the local bridge");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("keep the current Agent run active");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("wait_for_turn");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("cancellation");
  });

  it("preserves recoverable client error metadata without credentials", () => {
    const result = localToolError(new WaitloopClientError("network_unavailable", "network unavailable", {
      nextAction: "Retry the same wait.",
      retrySafe: true,
    }));
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]?.text).toContain("network_unavailable");
    expect(result.content[0]?.text).toContain("Retry the same wait.");
    expect(result.content[0]?.text).toContain("retrySafe");
    expect(result.content[0]?.text).not.toContain("wlseat_");
  });
});
