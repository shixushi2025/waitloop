import { describe, expect, it } from "vitest";

// Browser-only ESM ships without a bundling step.
// @ts-expect-error JavaScript module intentionally has no TypeScript declaration in public assets.
const selectors = await import("../public/game-selectors.js");

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "playing",
    roomPhase: "playing",
    viewerActorId: "human-1",
    viewerSeatId: "seat-1",
    actors: [
      { id: "human-1", kind: "human", label: "Human" },
      { id: "agent-1", kind: "connected-agent", label: "Codex" },
      { id: "agent-2", kind: "connected-agent", label: "Other" },
    ],
    actorStates: [
      { actorId: "agent-1", status: "connected" },
    ],
    seats: [
      { id: "seat-1", label: "you", activeControllerActorId: "human-1" },
      { id: "seat-2", label: "agent seat", activeControllerActorId: "agent-2" },
    ],
    bindings: [
      { actorId: "human-1", seatId: "seat-1", relation: "controller" },
      { actorId: "agent-1", seatId: "seat-1", relation: "advisor" },
      { actorId: "agent-2", seatId: "seat-2", relation: "controller" },
    ],
    capabilities: ["room:manage"],
    ...overrides,
  };
}

describe("standalone game snapshot selectors", () => {
  it("resolves the viewer, companion Advisor, and active Controller", () => {
    const current = snapshot();
    expect(selectors.viewerActorId(current)).toBe("human-1");
    expect(selectors.viewerSeatId(current)).toBe("seat-1");
    expect(selectors.companionActor(current)?.id).toBe("agent-1");
    expect(selectors.controllerActorForSeat(current, "seat-2")?.id).toBe("agent-2");
    expect(selectors.canManageRoom(current)).toBe(true);
  });

  it("does not select an Agent bound to another Seat as the companion", () => {
    const current = snapshot({
      bindings: [
        { actorId: "human-1", seatId: "seat-1", relation: "controller" },
        { actorId: "agent-1", seatId: "seat-2", relation: "advisor" },
      ],
    });
    expect(selectors.companionActor(current)).toBeNull();
  });

  it("keeps legacy participant, controller, and seat-state fallbacks", () => {
    const current = {
      status: "paused",
      participants: [{ id: "agent-old", kind: "connected-agent", label: "Legacy Agent" }],
      seatStates: [{ playerId: "agent-old", status: "disconnected" }],
    };
    expect(selectors.phaseOf(current)).toBe("paused");
    expect(selectors.viewerActorId(current)).toBe("you");
    expect(selectors.actorFor(current, "agent-old")?.label).toBe("Legacy Agent");
    expect(selectors.controllerActorForSeat(current, "agent-old")?.id).toBe("agent-old");
    expect(selectors.actorStateFor(current, "agent-old")?.status).toBe("disconnected");
  });

  it("uses stable labels without exposing missing identities", () => {
    const current = snapshot();
    expect(selectors.seatLabel(current, "seat-1")).toBe("you");
    expect(selectors.actorLabel(current, "human-1")).toBe("you");
    expect(selectors.actorLabel(current, "missing")).toBe("missing");
    expect(selectors.seatLabel(current, null)).toBe("room");
  });

  it("derives legacy phases without mutating the snapshot", () => {
    const finished = { status: "finished" };
    const paused = { status: "paused" };
    const playing = { status: "playing" };
    expect(selectors.phaseOf(finished)).toBe("finished");
    expect(selectors.phaseOf(paused)).toBe("paused");
    expect(selectors.phaseOf(playing)).toBe("playing");
    expect(finished).toEqual({ status: "finished" });
  });
});
