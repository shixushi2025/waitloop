import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublishedCliDiagnostic, inspectCodexHooks } from "../src/diagnostics.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Codex hook diagnostics", () => {
  it("reports the exact Waitloop lifecycle events that are installed", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-codex-diagnostic-"));
    const path = join(root, "hooks.json");
    try {
      await writeFile(path, JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "waitloop hook codex" }] }],
          PermissionRequest: [{ hooks: [{ type: "command", command: "waitloop hook codex" }] }],
          Stop: [{ hooks: [{ type: "command", command: "waitloop hook codex" }] }],
          SessionEnd: [{ hooks: [{ type: "command", command: "other command" }] }],
        },
      }));

      const result = await inspectCodexHooks(path);
      expect(result.exists).toBe(true);
      expect(result.installedEvents).toEqual(["UserPromptSubmit", "PermissionRequest", "Stop"]);
      expect(result.missingEvents).toEqual(["SessionEnd"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports all events missing when the hooks file does not exist", async () => {
    const result = await inspectCodexHooks(join(tmpdir(), `missing-waitloop-hooks-${Date.now()}.json`));
    expect(result.exists).toBe(false);
    expect(result.installedEvents).toEqual([]);
    expect(result.missingEvents).toEqual(["UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"]);
  });
});

describe("published CLI diagnostics", () => {
  it("reads the published CLI version and update command from agent.json", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      cli: {
        version: "0.1.0-alpha.9",
        installCommand: "npm install -g @waitloop/cli@alpha",
      },
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    await expect(fetchPublishedCliDiagnostic("https://waitloop.run")).resolves.toEqual({
      version: "0.1.0-alpha.9",
      installCommand: "npm install -g @waitloop/cli@alpha",
    });
  });

  it("fails closed when the machine manifest does not expose CLI metadata", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    await expect(fetchPublishedCliDiagnostic("https://waitloop.run")).resolves.toBeNull();
  });
});
