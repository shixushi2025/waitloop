import { describe, expect, it } from "vitest";

import {
  installLocalMcp,
  uninstallLocalMcp,
  type CommandResult,
} from "../src/mcp-install.js";

function result(status: number, stdout = "", stderr = ""): CommandResult {
  return { status, stdout, stderr };
}

describe("stable MCP installer", () => {
  it("does not overwrite an existing Codex MCP definition", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const installed = installLocalMcp("codex", (command, args) => {
      calls.push({ command, args });
      return result(0, "waitloop configured");
    });

    expect(installed.changed).toBe(false);
    expect(calls).toEqual([{ command: "codex", args: ["mcp", "get", "waitloop"] }]);
  });

  it("uses Claude's user-scoped stdio configuration command", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const installed = installLocalMcp("claude-code", (command, args) => {
      calls.push({ command, args });
      return calls.length === 1 ? result(1) : result(0, "added");
    });

    expect(installed.changed).toBe(true);
    expect(calls).toEqual([
      { command: "claude", args: ["mcp", "get", "waitloop"] },
      { command: "claude", args: ["mcp", "add", "--scope", "user", "waitloop", "--", "waitloop", "mcp"] },
    ]);
  });

  it("removes only a configured Codex MCP definition", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const removed = uninstallLocalMcp("codex", (command, args) => {
      calls.push({ command, args });
      return result(0);
    });

    expect(removed.changed).toBe(true);
    expect(calls).toEqual([
      { command: "codex", args: ["mcp", "get", "waitloop"] },
      { command: "codex", args: ["mcp", "remove", "waitloop"] },
    ]);
  });
});
