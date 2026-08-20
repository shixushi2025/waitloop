import { describe, expect, it } from "vitest";

import type { ActorRoomModelV1 } from "./room-actors";
import {
  actorHasCapability,
  canActorBecomeController,
  capabilitiesForActor,
  validateActorRoomModel,
} from "./room-actors";

function model(activeControllerActorId = "human"): ActorRoomModelV1 {
  return {
    roomOwnerActorId: "human",
    actors: [
      { version: 1, id: "human", kind: "human", label: "you" },
      { version: 1, id: "codex", kind: "connected-agent", label: "codex" },
      { version: 1, id: "bot", kind: "bot", label: "bot" },
    ],
    seats: [
      {
        version: 1,
        id: "seat-human",
        label: "you",
        ownerActorId: "human",
        activeControllerActorId,
      },
      {
        version: 1,
        id: "seat-bot",
        label: "bot",
        ownerActorId: "bot",
        activeControllerActorId: "bot",
      },
    ],
    bindings: [
      { version: 1, actorId: "human", seatId: "seat-human", relation: "controller" },
      { version: 1, actorId: "codex", seatId: "seat-human", relation: "advisor" },
      { version: 1, actorId: "bot", seatId: "seat-bot", relation: "controller" },
    ],
    actorStates: {},
  };
}

describe("room actor capabilities", () => {
  it("lets an advisor inspect private state and comment without playing", () => {
    const value = model();
    validateActorRoomModel(value);

    expect(capabilitiesForActor(value, "codex")).toEqual([
      "room:view-public",
      "seat:view-private",
      "seat:inspect-legal",
      "room:comment",
    ]);
    expect(actorHasCapability(value, "codex", "seat:play")).toBe(false);
    expect(canActorBecomeController(value, "seat-human", "codex")).toBe(true);
  });

  it("grants play only to the active controller while the owner retains control authority", () => {
    const value = model("codex");
    validateActorRoomModel(value);

    expect(actorHasCapability(value, "codex", "seat:play")).toBe(true);
    expect(actorHasCapability(value, "human", "seat:play")).toBe(false);
    expect(actorHasCapability(value, "human", "seat:control")).toBe(true);
    expect(actorHasCapability(value, "codex", "seat:control")).toBe(false);
  });

  it("gives only the room owner room management authority", () => {
    const value = model();
    validateActorRoomModel(value);

    expect(actorHasCapability(value, "human", "room:manage")).toBe(true);
    expect(actorHasCapability(value, "codex", "room:manage")).toBe(false);
    expect(actorHasCapability(value, "bot", "room:manage")).toBe(false);
  });

  it("rejects an unknown room owner", () => {
    const value = model();
    value.roomOwnerActorId = "missing";
    expect(() => validateActorRoomModel(value)).toThrow(/room owner/i);
  });

  it("rejects a controller that is not bound to the seat", () => {
    const value = model("bot");
    expect(() => validateActorRoomModel(value)).toThrow(/controller must be bound/i);
  });
});
