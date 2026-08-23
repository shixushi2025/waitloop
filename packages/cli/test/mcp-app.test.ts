import { describe, expect, it } from "vitest";

import {
  MCP_APP_RECENT_ACTIVITY_LIMIT,
  MCP_APP_REFRESH_MAX_DELAY_MS,
  MCP_APP_REFRESH_MIN_DELAY_MS,
  WAITLOOP_GAME_APP_HTML,
} from "../src/mcp-app.js";

describe("Human MCP App presentation", () => {
  it("shows a bounded recent activity list without an internal scrollbar", () => {
    expect(MCP_APP_RECENT_ACTIVITY_LIMIT).toBe(4);
    expect(WAITLOOP_GAME_APP_HTML).toContain("var RECENT_ACTIVITY_LIMIT = 4;");
    expect(WAITLOOP_GAME_APP_HTML).toContain("slice(-RECENT_ACTIVITY_LIMIT)");
    expect(WAITLOOP_GAME_APP_HTML).toContain("className = \"activity-row\"");
    expect(WAITLOOP_GAME_APP_HTML).toContain(".activity-row { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("max-height: 98px");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("overflow: auto");
  });

  it("keeps automatic refresh visible-only and bounded between five and thirty seconds", () => {
    expect(MCP_APP_REFRESH_MIN_DELAY_MS).toBe(5_000);
    expect(MCP_APP_REFRESH_MAX_DELAY_MS).toBe(30_000);
    expect(WAITLOOP_GAME_APP_HTML).toContain("var REFRESH_MIN_DELAY_MS = 5000;");
    expect(WAITLOOP_GAME_APP_HTML).toContain("var REFRESH_MAX_DELAY_MS = 30000;");
    expect(WAITLOOP_GAME_APP_HTML).toContain("scheduleRefresh");
    expect(WAITLOOP_GAME_APP_HTML).toContain("stopRefresh");
    expect(WAITLOOP_GAME_APP_HTML).toContain('document.visibilityState !== "visible"');
    expect(WAITLOOP_GAME_APP_HTML).toContain("Math.min(REFRESH_MAX_DELAY_MS");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("}, 1200)");
  });
});
