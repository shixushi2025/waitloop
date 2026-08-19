import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { installClaudeCode, uninstallClaudeCode, WAITLOOP_CLAUDE_HOOK_COMMAND } from "../src/claude-code.js";

async function tempSettings(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "waitloop-cli-test-"));
  return join(directory, "settings.json");
}

describe("Claude Code installer", () => {
  it("merges Waitloop hooks without replacing existing hooks", async () => {
    const path = await tempSettings();
    await writeFile(path, JSON.stringify({
      hooks: {
        Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo existing" }] }],
      },
      theme: "dark",
    }));

    const first = await installClaudeCode(path);
    const second = await installClaudeCode(path);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);

    const settings = JSON.parse(await readFile(path, "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.Stop[0].hooks.map((hook: { command: string }) => hook.command)).toEqual([
      "echo existing",
      WAITLOOP_CLAUDE_HOOK_COMMAND,
    ]);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("removes only Waitloop hook handlers", async () => {
    const path = await tempSettings();
    await writeFile(path, JSON.stringify({
      hooks: {
        Stop: [{
          matcher: "",
          hooks: [
            { type: "command", command: WAITLOOP_CLAUDE_HOOK_COMMAND },
            { type: "command", command: "echo keep" },
          ],
        }],
      },
    }));

    const result = await uninstallClaudeCode(path);
    expect(result.changed).toBe(true);
    const settings = JSON.parse(await readFile(path, "utf8"));
    expect(settings.hooks.Stop[0].hooks).toEqual([{ type: "command", command: "echo keep" }]);
  });
});
