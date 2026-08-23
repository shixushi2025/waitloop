import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("browser request budgets", () => {
  it("uses visible-only bounded fallback refresh in the Human MCP App", () => {
    const app = source("packages/cli/src/mcp-app.ts");
    expect(app).toContain("MCP_APP_REFRESH_MIN_DELAY_MS = 5000");
    expect(app).toContain("MCP_APP_REFRESH_MAX_DELAY_MS = 30000");
    expect(app).toContain("scheduleRefresh");
    expect(app).toContain("stopRefresh");
    expect(app).toContain('document.visibilityState !== "visible"');
    expect(app).toContain('window.addEventListener("pagehide", stopRefresh)');
    expect(app).not.toContain("}, 1200)");
  });

  it("backs visible connected-room polling off and stops it while hidden", () => {
    const game = source("apps/web/public/game.js");
    expect(game).toContain("shouldRefreshRoom(current, !document.hidden)");
    expect(game).toContain("nextRoomRefreshDelay");
    expect(game).toContain("stopRoomRefresh");
    expect(game).toContain("if (document.hidden)");
    expect(game).not.toContain("}, 1000);\n}");
  });

  it("backs failed lifecycle WebSocket reconnects off and restores safely after page lifecycle changes", () => {
    const app = source("apps/web/public/app.js");
    expect(app).toContain("MAX_SESSION_RECONNECT_DELAY_MS");
    expect(app).toContain("scheduleSessionReconnect");
    expect(app).toContain("document.hidden");
    expect(app).toContain('window.addEventListener("pagehide"');
    expect(app).toContain('window.addEventListener("pageshow"');
    expect(app).not.toContain("window.setTimeout(() => connectSessionSocket(id), 1500)");
  });
});
