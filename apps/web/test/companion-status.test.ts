import { describe, expect, it } from "vitest";

// Browser-only ESM is shipped without a build step; this test validates its copy contract.
// @ts-expect-error JavaScript module intentionally has no TypeScript declaration in public assets.
import { companionEmptyStateText } from "../public/companion-status.js";

describe("companion presence copy", () => {
  it("does not claim connection before the Agent is connected", () => {
    expect(companionEmptyStateText(undefined)).toBe("agent not joined · no comments yet");
    expect(companionEmptyStateText("waiting")).toBe("agent not joined · no comments yet");
    expect(companionEmptyStateText("connecting")).toBe("credential claimed · waiting for MCP connection");
  });

  it("distinguishes connected and disconnected Advisors", () => {
    expect(companionEmptyStateText("connected")).toBe("agent connected · no comments yet");
    expect(companionEmptyStateText("disconnected")).toBe("agent away · no comments yet");
  });
});
