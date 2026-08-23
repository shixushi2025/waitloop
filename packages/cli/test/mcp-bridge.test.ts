import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createLocalMcpServer,
  localToolErrorPayload,
  LOCAL_MCP_INSTRUCTIONS,
  LOCAL_MCP_TOOLS,
} from "../src/mcp-bridge.js";
import {
  MCP_APP_MIME_TYPE,
  WAITLOOP_GAME_APP_HTML,
  WAITLOOP_GAME_UI_URI,
} from "../src/mcp-app.js";

describe("stable local MCP bridge", () => {
  it("advertises Agent and Human-app tools without model-visible credentials", () => {
    const names = LOCAL_MCP_TOOLS.map((tool) => tool.name);

    expect(names).toEqual([
      "open_game",
      "create_room",
      "join_room",
      "get_active_room",
      "leave_room",
      "get_turn",
      "wait_for_turn",
      "wait_for_room_update",
      "play_move",
      "comment",
      "yield_to_bot",
      "take_control",
      "ui_get_game",
      "ui_play_cards",
      "ui_pass",
      "ui_hint",
    ]);
    expect(JSON.stringify(LOCAL_MCP_TOOLS)).not.toContain("wlseat_");
    expect(JSON.stringify(LOCAL_MCP_TOOLS)).not.toContain("wlview_");

    const roomWait = LOCAL_MCP_TOOLS.find((tool) => tool.name === "wait_for_room_update");
    expect(roomWait?.inputSchema.required).toEqual(["afterRoomSeq"]);
    expect(JSON.stringify(roomWait?.inputSchema)).toContain("afterRoomSeq");

    const open = LOCAL_MCP_TOOLS.find((tool) => tool.name === "open_game");
    expect(open?.uiVisibility).toEqual(["model", "app"]);
    for (const name of ["ui_get_game", "ui_play_cards", "ui_pass", "ui_hint"]) {
      const tool = LOCAL_MCP_TOOLS.find((candidate) => candidate.name === name);
      expect(tool?.uiVisibility).toEqual(["app"]);
      expect(JSON.stringify(tool?.inputSchema)).toContain("uiToken");
      expect(JSON.stringify(tool?.inputSchema)).toContain("wlui_");
    }
  });

  it("builds the official SDK server and distinguishes Human UI from Agent-owned play", () => {
    expect(createLocalMcpServer()).toBeDefined();
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("open_game()");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("create_room()");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("MCP Apps-capable Host");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("credentials inside the local bridge");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("tool-result metadata");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("never part of model-visible content");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("keep the current Agent run active");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("wait_for_turn");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("wait_for_room_update");
    expect(LOCAL_MCP_INSTRUCTIONS).toContain("cancellation");
  });

  it("ships a self-contained credential-free MCP App resource with valid JavaScript", () => {
    expect(WAITLOOP_GAME_UI_URI).toBe("ui://waitloop/doudizhu/v1");
    expect(MCP_APP_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect(WAITLOOP_GAME_APP_HTML).toContain("ui/initialize");
    expect(WAITLOOP_GAME_APP_HTML).toContain("ui/notifications/tool-result");
    expect(WAITLOOP_GAME_APP_HTML).toContain("waitloop/uiToken");
    expect(WAITLOOP_GAME_APP_HTML).toContain("ui_get_game");
    expect(WAITLOOP_GAME_APP_HTML).toContain("ui_play_cards");
    expect(WAITLOOP_GAME_APP_HTML).toContain("ui_pass");
    expect(WAITLOOP_GAME_APP_HTML).toContain("ui_hint");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("wlview_");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("wla_");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("wlseat_");
    expect(WAITLOOP_GAME_APP_HTML).not.toMatch(/wlui_[a-f0-9]{64}/);
    expect(WAITLOOP_GAME_APP_HTML).not.toMatch(/<script[^>]+src=/i);
    expect(WAITLOOP_GAME_APP_HTML).not.toMatch(/<link[^>]+href=/i);

    const script = /<script>([\s\S]*?)<\/script>/i.exec(WAITLOOP_GAME_APP_HTML)?.[1];
    expect(script).toBeTruthy();
    const root = mkdtempSync(join(tmpdir(), "waitloop-mcp-app-js-"));
    try {
      const path = join(root, "app.js");
      writeFileSync(path, script!, "utf8");
      expect(() => execFileSync(process.execPath, ["--check", path], { stdio: "pipe" })).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns corrective actions and redacts credential-shaped error text", () => {
    const missing = localToolErrorPayload(new Error("No active Waitloop room. Use create_room or join_room first."));
    expect(missing).toMatchObject({ code: "active_room_missing" });
    expect(missing.nextAction).toContain("create_room()");

    const interactive = localToolErrorPayload(new Error("Interactive Room is not available in this local bridge."));
    expect(interactive).toMatchObject({ code: "interactive_room_missing" });
    expect(interactive.nextAction).toContain("open_game()");

    const unauthorized = localToolErrorPayload(new Error("Interactive UI capability is invalid."));
    expect(unauthorized).toMatchObject({ code: "interactive_ui_unauthorized" });
    expect(unauthorized.nextAction).toContain("open_game(roomId)");

    const leaked = localToolErrorPayload(new Error("remote failed for wlseat_super_secret_123 and wlui_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"));
    expect(leaked.message).not.toContain("wlseat_");
    expect(leaked.message).not.toContain("wlui_");
    expect(leaked.message).toContain("[redacted]");

    const cancelled = new Error("cancelled");
    cancelled.name = "AbortError";
    expect(localToolErrorPayload(cancelled)).toMatchObject({ code: "cancelled" });
  });
});
