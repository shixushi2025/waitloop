import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, saveConfig } from "../src/config.js";
import { pairDevice, unpairDevice } from "../src/pairing.js";

const originalConfigPath = process.env.WAITLOOP_CONFIG_PATH;
const originalBootstrapToken = process.env.WAITLOOP_BOOTSTRAP_TOKEN;

afterEach(() => {
  if (originalConfigPath === undefined) delete process.env.WAITLOOP_CONFIG_PATH;
  else process.env.WAITLOOP_CONFIG_PATH = originalConfigPath;
  if (originalBootstrapToken === undefined) delete process.env.WAITLOOP_BOOTSTRAP_TOKEN;
  else process.env.WAITLOOP_BOOTSTRAP_TOKEN = originalBootstrapToken;
});

describe.sequential("device pairing", () => {
  it("stores a scoped device token, removes the legacy ingest token, and self-revokes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "waitloop-pairing-test-"));
    process.env.WAITLOOP_CONFIG_PATH = join(directory, "config.json");
    process.env.WAITLOOP_BOOTSTRAP_TOKEN = "bootstrap-secret";

    let revokeAuthorization = "";
    const server = createServer(async (request, response) => {
      if (request.method === "POST" && request.url === "/api/v1/devices/bootstrap") {
        expect(request.headers.authorization).toBe("Bearer bootstrap-secret");
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(body).toEqual({ version: 1, deviceId: "device-test" });
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({
          version: 1,
          deviceId: "device-test",
          deviceToken: "wldev_1234567890123456789012345678901234567890",
          scopes: ["agent:write"],
        }));
        return;
      }

      if (request.method === "DELETE" && request.url === "/api/v1/devices/current") {
        revokeAuthorization = request.headers.authorization ?? "";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version: 1, revoked: true, deviceId: "device-test" }));
        return;
      }

      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      await saveConfig({
        version: 1,
        url: `http://127.0.0.1:${address.port}`,
        deviceId: "device-test",
        ingestToken: "legacy-ingest-secret",
      });

      expect(await pairDevice()).toEqual({ deviceId: "device-test", scopes: ["agent:write"] });
      const paired = await loadConfig();
      expect(paired?.deviceToken).toBe("wldev_1234567890123456789012345678901234567890");
      expect(paired?.ingestToken).toBeUndefined();

      expect(await unpairDevice()).toEqual({ paired: true, revoked: true });
      expect(revokeAuthorization).toBe("Bearer wldev_1234567890123456789012345678901234567890");
      expect((await loadConfig())?.deviceToken).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
