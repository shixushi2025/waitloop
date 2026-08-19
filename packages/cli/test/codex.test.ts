import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { installCodex, uninstallCodex, WAITLOOP_CODEX_HOOK_COMMAND } from "../src/codex.js";

async function tempHooks(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "waitloop-codex-test-"));
  return join(directory, "hooks.json");
}

describe("Codex installer", () => {
  it("merges and deduplicates Waitloop matcher groups", async () => {
    const path = await tempHooks();
    await writeFile(path, JSON.stringify({
      description: "existing",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo existing" }] }],
      },
    }));

    expect((await installCodex(path)).changed).toBe(true);
    expect((await installCodex(path)).changed).toBe(false);

    const value = JSON.parse(await readFile(path, "utf8"));
    expect(value.description).toBe("existing");
    expect(value.hooks.Stop).toHaveLength(2);
    expect(value.hooks.Stop[1].hooks[0].command).toBe(WAITLOOP_CODEX_HOOK_COMMAND);
    expect(value.hooks.UserPromptSubmit[0].hooks[0]).toMatchObject({
      type: "command",
      command: WAITLOOP_CODEX_HOOK_COMMAND,
      async: true,
    });
    expect(value.hooks.SessionEnd[0].hooks[0].async).toBeUndefined();
  });

  it("removes only Waitloop hook handlers", async () => {
    const path = await tempHooks();
    await writeFile(path, JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [
            { type: "command", command: WAITLOOP_CODEX_HOOK_COMMAND },
            { type: "command", command: "echo keep" },
          ],
        }],
      },
    }));

    expect((await uninstallCodex(path)).changed).toBe(true);
    const value = JSON.parse(await readFile(path, "utf8"));
    expect(value.hooks.Stop[0].hooks).toEqual([{ type: "command", command: "echo keep" }]);
  });
});
