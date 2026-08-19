import { describe, expect, it } from "vitest";

import { createConfig, normalizeUrl } from "../src/config.js";

describe("Waitloop CLI config", () => {
  it("normalizes a trailing slash", () => {
    expect(normalizeUrl("https://waitloop.run/")).toBe("https://waitloop.run");
  });

  it("rejects credentials in server URLs", () => {
    expect(() => normalizeUrl("https://user:pass@waitloop.run")).toThrow();
  });

  it("preserves the device id and tokens when updating the URL", () => {
    const previous = {
      version: 1 as const,
      url: "https://old.example",
      deviceId: "device-1",
      ingestToken: "secret",
    };
    expect(createConfig({ previous, url: "https://waitloop.run" })).toEqual({
      version: 1,
      url: "https://waitloop.run",
      deviceId: "device-1",
      ingestToken: "secret",
    });
  });
});
