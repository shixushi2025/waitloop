import { describe, expect, it } from "vitest";

import {
  MCP_APP_RECENT_ACTIVITY_LIMIT,
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

  it("uses response-driven state and one-shot recovery without a periodic refresh timer", () => {
    expect(WAITLOOP_GAME_APP_HTML).toContain("refreshWhenVisible");
    expect(WAITLOOP_GAME_APP_HTML).toContain("visibilitychange");
    expect(WAITLOOP_GAME_APP_HTML).toContain('window.addEventListener("focus", refreshWhenVisible)');
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("scheduleRefresh");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("refreshTimer");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("REFRESH_MAX_DELAY_MS");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("}, 1200)");
  });
});
