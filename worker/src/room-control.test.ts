import { describe, expect, it } from "vitest";

import type { RoomControlModelV1 } from "./room-control";
import {
  activateTemporaryBotControl,
  hasTemporaryBotControl,
  restoreSeatOwnerControl,
  setBoundSeatController,
} from "./room-control";

function model(): RoomControlModelV1 {
  return {
    roomOwnerActorId: "human",
    actors: [
      { version: 1, id: "human", kind: "human", label: "you" },
      { version: 1, id: "agent", kind: "connected-agent", label: "agent" },
      { version: 1, id: "bot", kind: "bot", label: "bot" },
    ],
    seats: [
      { version: 1, id: "seat-1", label: "you", ownerActorId: "human", activeControllerActorId: "human" },
      { version: 1, id: "seat-2", label: "agent", ownerActorId: "agent", activeControllerActorId: "agent" },
      { version: 1, id: "seat-3", label: "bot", ownerActorId: "bot", activeControllerActorId: "bot" },
    ],
    bindings: [
      { version: 1, actorId: "human", seatId: "seat-1", relation: "controller" },
      { version: 1, actorId: "agent", seatId: "seat-2", relation: "controller" },
      { version: 1, actorId: "bot", seatId: "seat-3", relation: "controller" },
    ],
    actorStates: {
      human: { version: 1, actorId: "human", status: "ready", statusChangedAt: 1 },
      agent: { version: 1, actorId: "agent", status: "connected", statusChangedAt: 1, connectedAt: 1, lastSeenAt: 2 },
      bot: { version: 1, actorId: "bot", status: "ready", statusChangedAt: 1 },
    },
    botPlayerIds: ["seat-3"],
    temporaryBotSeatIds: [],
  };
}

describe("temporary seat control", () => {
  it("lets a temporary bot take over without changing seat ownership", () => {
    const next = activateTemporaryBotControl(model(), "seat-2", "temp-bot", 10);
    const seat = next.seats.find((item) => item.id === "seat-2")!;

    expect(seat.ownerActorId).toBe("agent");
    expect(seat.activeControllerActorId).toBe("temp-bot");
    expect(next.botPlayerIds).toContain("seat-2");
    expect(next.temporaryBotSeatIds).toContain("seat-2");
    expect(next.actors.find((actor) => actor.id === "temp-bot")?.temporary).toBe(true);
    expect(next.actorStates.agent?.status).toBe("disconnected");
    expect(hasTemporaryBotControl(next, "seat-2")).toBe(true);
  });

  it("restores the original owner and removes only the temporary bot", () => {
    const taken = activateTemporaryBotControl(model(), "seat-2", "temp-bot", 10);
    const restored = restoreSeatOwnerControl(taken, "seat-2");
    const seat = restored.seats.find((item) => item.id === "seat-2")!;

    expect(seat.ownerActorId).toBe("agent");
    expect(seat.activeControllerActorId).toBe("agent");
    expect(restored.actors.some((actor) => actor.id === "temp-bot")).toBe(false);
    expect(restored.botPlayerIds).toEqual(["seat-3"]);
    expect(restored.temporaryBotSeatIds).toEqual([]);
    expect(restored.actors.some((actor) => actor.id === "bot")).toBe(true);
  });

  it("never allows takeover of a native bot seat", () => {
    expect(() => activateTemporaryBotControl(model(), "seat-3", "temp-bot", 10)).toThrow(/native bot/i);
  });

  it("cleans a temporary bot when a bound actor becomes controller again", () => {
    const value = model();
    value.actors.push({ version: 1, id: "advisor", kind: "connected-agent", label: "advisor" });
    value.bindings.push({ version: 1, actorId: "advisor", seatId: "seat-1", relation: "advisor" });
    value.actorStates.advisor = { version: 1, actorId: "advisor", status: "connected", statusChangedAt: 1 };

    const taken = activateTemporaryBotControl(value, "seat-1", "temp-bot", 10);
    const delegated = setBoundSeatController(taken, "seat-1", "advisor");
    expect(delegated.seats.find((item) => item.id === "seat-1")?.activeControllerActorId).toBe("advisor");
    expect(delegated.actors.some((actor) => actor.id === "temp-bot")).toBe(false);
    expect(delegated.botPlayerIds).toEqual(["seat-3"]);
  });
});
