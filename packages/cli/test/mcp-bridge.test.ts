import { describe, expect, it } from "vitest";

import {
  createLocalMcpServer,
  localToolErrorPayload,
  LOCAL_MCP_INSTRUCTIONS,
  LOCAL_MCP_TOOLS,
} from "../src/mcp-bridge.js";

describe("stable local MCP bridge", () => {
  it("advertises control and gameplay tools without model-visible credentials", () => {
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
  });

  it("builds the official SDK server and explains continuous play, cancellation, and local credential custody", () => {
    expect(createLocalMcpServer()).toBeDefined();
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("credentials inside the local bridge");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("keep the current Agent run active");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("wait_for_turn");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("cancellation");
  });

  it("returns corrective actions and redacts credential-shaped error text", () => {
    const missing = localToolErrorPayload(new Error("No active Waitloop room. Use create_room or join_room first."));
    expect(missing).toMatchObject({ code: "active_room_missing" });
    expect(missing.nextAction).toContain("create_room()");

    const leaked = localToolErrorPayload(new Error("remote failed for wlseat_super_secret_123"));
    expect(leaked.message).not.toContain("wlseat_");
    expect(leaked.message).toContain("[redacted]");

    const cancelled = new Error("cancelled");
    cancelled.name = "AbortError";
    expect(localToolErrorPayload(cancelled)).toMatchObject({ code: "cancelled" });
  });
});
