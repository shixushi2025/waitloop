import type {
  GameActorBindingV1,
  GameActorRuntimeV1,
  GameActorV1,
  GameSeatV1,
} from "./participants";
import {
  actorById,
  bindingForActor,
  canActorBecomeController,
  seatById,
  type ActorRoomModelV1,
  validateActorRoomModel,
} from "./room-actors";

export interface RoomControlModelV1 extends ActorRoomModelV1 {
  botPlayerIds: string[];
  temporaryBotSeatIds: string[];
}

function cloneActorStates(source: Record<string, GameActorRuntimeV1>): Record<string, GameActorRuntimeV1> {
  return Object.fromEntries(Object.entries(source).map(([id, value]) => [id, { ...value }]));
}

function temporaryBotActorIdsForSeat(model: RoomControlModelV1, seatId: string): Set<string> {
  const result = new Set<string>();
  for (const binding of model.bindings) {
    if (binding.seatId !== seatId) continue;
    const actor = actorById(model, binding.actorId);
    if (actor?.kind === "bot" && actor.temporary === true) result.add(actor.id);
  }
  return result;
}

function withoutTemporaryBotForSeat(model: RoomControlModelV1, seatId: string): RoomControlModelV1 {
  const temporaryActorIds = temporaryBotActorIdsForSeat(model, seatId);
  if (temporaryActorIds.size === 0 && !model.temporaryBotSeatIds.includes(seatId)) return model;

  const actorStates = cloneActorStates(model.actorStates);
  for (const actorId of temporaryActorIds) delete actorStates[actorId];

  return {
    ...model,
    actors: model.actors.filter((actor) => !temporaryActorIds.has(actor.id)),
    bindings: model.bindings.filter((binding) => !temporaryActorIds.has(binding.actorId)),
    actorStates,
    botPlayerIds: model.botPlayerIds.filter((id) => id !== seatId),
    temporaryBotSeatIds: model.temporaryBotSeatIds.filter((id) => id !== seatId),
  };
}

export function activateTemporaryBotControl(
  model: RoomControlModelV1,
  seatId: string,
  temporaryActorId: string,
  now: number,
): RoomControlModelV1 {
  const seat = seatById(model, seatId);
  if (!seat) throw new Error("Unknown seat.");
  if (model.botPlayerIds.includes(seatId) && !model.temporaryBotSeatIds.includes(seatId)) {
    throw new Error("Native bot seats cannot be replaced by another bot controller.");
  }
  if (actorById(model, temporaryActorId)) throw new Error("Temporary actor ID is already in use.");

  const currentController = actorById(model, seat.activeControllerActorId);
  const actorStates = cloneActorStates(model.actorStates);
  if (currentController?.kind === "connected-agent") {
    const current = actorStates[currentController.id];
    actorStates[currentController.id] = {
      version: 1,
      actorId: currentController.id,
      status: "disconnected",
      statusChangedAt: now,
      ...(current?.connectedAt === undefined ? {} : { connectedAt: current.connectedAt }),
      disconnectedAt: now,
      ...(current?.lastSeenAt === undefined ? {} : { lastSeenAt: current.lastSeenAt }),
    };
  }

  const temporaryActor: GameActorV1 = {
    version: 1,
    id: temporaryActorId,
    kind: "bot",
    label: "bot takeover",
    temporary: true,
  };
  const temporaryBinding: GameActorBindingV1 = {
    version: 1,
    actorId: temporaryActorId,
    seatId,
    relation: "controller",
  };
  actorStates[temporaryActorId] = {
    version: 1,
    actorId: temporaryActorId,
    status: "ready",
    statusChangedAt: now,
  };

  const next: RoomControlModelV1 = {
    ...model,
    actors: [...model.actors, temporaryActor],
    seats: model.seats.map((item): GameSeatV1 => item.id === seatId
      ? { ...item, activeControllerActorId: temporaryActorId }
      : item),
    bindings: [...model.bindings, temporaryBinding],
    actorStates,
    botPlayerIds: model.botPlayerIds.includes(seatId) ? [...model.botPlayerIds] : [...model.botPlayerIds, seatId],
    temporaryBotSeatIds: model.temporaryBotSeatIds.includes(seatId)
      ? [...model.temporaryBotSeatIds]
      : [...model.temporaryBotSeatIds, seatId],
  };
  validateActorRoomModel(next);
  return next;
}

export function restoreSeatOwnerControl(
  model: RoomControlModelV1,
  seatId: string,
): RoomControlModelV1 {
  const seat = seatById(model, seatId);
  if (!seat) throw new Error("Unknown seat.");
  if (!canActorBecomeController(model, seatId, seat.ownerActorId)) throw new Error("Seat owner is not bound to the seat.");

  const cleaned = withoutTemporaryBotForSeat(model, seatId);
  const next: RoomControlModelV1 = {
    ...cleaned,
    seats: cleaned.seats.map((item): GameSeatV1 => item.id === seatId
      ? { ...item, activeControllerActorId: seat.ownerActorId }
      : item),
  };
  validateActorRoomModel(next);
  return next;
}

export function setBoundSeatController(
  model: RoomControlModelV1,
  seatId: string,
  targetActorId: string,
): RoomControlModelV1 {
  if (!canActorBecomeController(model, seatId, targetActorId)) throw new Error("Target actor is not bound to the seat.");
  const target = actorById(model, targetActorId);
  const cleaned = target?.temporary === true ? model : withoutTemporaryBotForSeat(model, seatId);
  const next: RoomControlModelV1 = {
    ...cleaned,
    seats: cleaned.seats.map((item): GameSeatV1 => item.id === seatId
      ? { ...item, activeControllerActorId: targetActorId }
      : item),
  };
  validateActorRoomModel(next);
  return next;
}

export function hasTemporaryBotControl(model: RoomControlModelV1, seatId: string): boolean {
  return model.temporaryBotSeatIds.includes(seatId) && temporaryBotActorIdsForSeat(model, seatId).size > 0;
}

export function ownerActorForSeat(model: RoomControlModelV1, seatId: string): GameActorV1 | null {
  const seat = seatById(model, seatId);
  return seat ? actorById(model, seat.ownerActorId) : null;
}

export function controllerBindingForSeat(model: RoomControlModelV1, seatId: string): GameActorBindingV1 | null {
  const seat = seatById(model, seatId);
  if (!seat) return null;
  const binding = bindingForActor(model, seat.activeControllerActorId);
  return binding?.seatId === seatId ? binding : null;
}
