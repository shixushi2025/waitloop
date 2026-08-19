import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { installCursor, uninstallCursor, WAITLOOP_CURSOR_HOOK_COMMAND } from "../src/cursor.js";

async function tempHooks(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "waitloop-cursor-test-"));
  return join(directory, "hooks.json");
}

describe("Cursor installer", () => {
  it("merges and deduplicates Waitloop handlers", async () => {
    const path = await tempHooks();
    await writeFile(path, JSON.stringify({
      version: 1,
      hooks: {
        stop: [{ command: "echo existing" }],
      },
    }));

    expect((await installCursor(path)).changed).toBe(true);
    expect((await installCursor(path)).changed).toBe(false);

    const hooks = JSON.parse(await readFile(path, "utf8"));
    expect(hooks.hooks.stop).toEqual([
      { command: "echo existing" },
      { command: WAITLOOP_CURSOR_HOOK_COMMAND },
    ]);
    expect(hooks.hooks.beforeSubmitPrompt).toEqual([{ command: WAITLOOP_CURSOR_HOOK_COMMAND }]);
  });

  it("removes only Waitloop handlers", async () => {
    const path = await tempHooks();
    await writeFile(path, JSON.stringify({
      version: 1,
      hooks: {
        stop: [{ command: WAITLOOP_CURSOR_HOOK_COMMAND }, { command: "echo keep" }],
      },
    }));

    expect((await uninstallCursor(path)).changed).toBe(true);
    const hooks = JSON.parse(await readFile(path, "utf8"));
    expect(hooks.hooks.stop).toEqual([{ command: "echo keep" }]);
  });
});
