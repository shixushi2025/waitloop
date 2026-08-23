import { afterEach, describe, expect, it, vi } from "vitest";

import { WAITLOOP_GAME_APP_HTML } from "../src/mcp-app.js";

interface RefreshRuntimeState {
  payload: { roomId: string } | null;
  refreshBusy: boolean;
  actionBusy: boolean;
  connected: boolean;
}

function extractFunction(name: string): string {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  const start = patterns.map((pattern) => WAITLOOP_GAME_APP_HTML.indexOf(pattern)).find((value) => value >= 0) ?? -1;
  if (start < 0) throw new Error(`Embedded MCP App function ${name} was not found.`);
  const bodyStart = WAITLOOP_GAME_APP_HTML.indexOf("{", start);
  if (bodyStart < 0) throw new Error(`Embedded MCP App function ${name} has no body.`);

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = bodyStart; index < WAITLOOP_GAME_APP_HTML.length; index += 1) {
    const character = WAITLOOP_GAME_APP_HTML[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return WAITLOOP_GAME_APP_HTML.slice(start, index + 1);
    }
  }
  throw new Error(`Embedded MCP App function ${name} is incomplete.`);
}

function createRuntime(options: {
  state: RefreshRuntimeState;
  callTool: (name: string, args: Record<string, unknown>, quiet: boolean) => Promise<unknown>;
  visible?: boolean;
}) {
  const refreshSource = extractFunction("refresh");
  const visibleSource = extractFunction("refreshWhenVisible");
  const document = { visibilityState: options.visible === false ? "hidden" : "visible" };
  const factory = new Function(
    "state",
    "callTool",
    "setMessage",
    "canUseTools",
    "document",
    `${refreshSource}\n${visibleSource}\nreturn { refresh, refreshWhenVisible };`,
  ) as (
    state: RefreshRuntimeState,
    callTool: typeof options.callTool,
    setMessage: () => void,
    canUseTools: () => boolean,
    document: { visibilityState: string },
  ) => { refresh(quiet: boolean): Promise<void>; refreshWhenVisible(): void };

  return {
    document,
    runtime: factory(options.state, options.callTool, () => undefined, () => options.state.connected, document),
  };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("embedded Human MCP App request budget", () => {
  it("does not generate periodic Worker reads while idle for 24 hours", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn(async () => undefined);
    createRuntime({
      state: { payload: { roomId: "room-1" }, refreshBusy: false, actionBusy: false, connected: true },
      callTool,
    });

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(callTool).not.toHaveBeenCalled();
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("scheduleRefresh");
    expect(WAITLOOP_GAME_APP_HTML).not.toContain("refreshTimer");
  });

  it("coalesces repeated focus/visibility recovery while one refresh is in flight", async () => {
    const pending = deferred();
    const callTool = vi.fn(() => pending.promise);
    const state = { payload: { roomId: "room-1" }, refreshBusy: false, actionBusy: false, connected: true };
    const { runtime } = createRuntime({ state, callTool });

    for (let index = 0; index < 30; index += 1) runtime.refreshWhenVisible();
    await Promise.resolve();
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("ui_get_game", { roomId: "room-1" }, true);

    pending.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.refreshBusy).toBe(false);
  });

  it("does not refresh while hidden, busy, or torn down", async () => {
    const callTool = vi.fn(async () => undefined);
    const state = { payload: { roomId: "room-1" }, refreshBusy: false, actionBusy: false, connected: true };
    const { runtime, document } = createRuntime({ state, callTool, visible: false });

    runtime.refreshWhenVisible();
    state.actionBusy = true;
    document.visibilityState = "visible";
    runtime.refreshWhenVisible();
    state.actionBusy = false;
    state.connected = false;
    runtime.refreshWhenVisible();
    await Promise.resolve();

    expect(callTool).not.toHaveBeenCalled();
  });
});
