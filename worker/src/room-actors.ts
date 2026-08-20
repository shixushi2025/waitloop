import type {
  GameActorBindingV1,
  GameActorRuntimeV1,
  GameActorV1,
  GameCapabilityV1,
  GameSeatV1,
} from "./participants";

export interface ActorRoomModelV1 {
  actors: GameActorV1[];
  seats: GameSeatV1[];
  bindings: GameActorBindingV1[];
  actorStates: Record<string, GameActorRuntimeV1>;
}

export function actorById(model: Pick<ActorRoomModelV1, "actors">, actorId: string): GameActorV1 | null {
  return model.actors.find((actor) => actor.id === actorId) ?? null;
}

export function seatById(model: Pick<ActorRoomModelV1, "seats">, seatId: string): GameSeatV1 | null {
  return model.seats.find((seat) => seat.id === seatId) ?? null;
}

export function bindingForActor(
  model: Pick<ActorRoomModelV1, "bindings">,
  actorId: string,
): GameActorBindingV1 | null {
  return model.bindings.find((binding) => binding.actorId === actorId) ?? null;
}

export function seatForActor(
  model: Pick<ActorRoomModelV1, "seats" | "bindings">,
  actorId: string,
): GameSeatV1 | null {
  const binding = bindingForActor(model, actorId);
  return binding ? seatById(model, binding.seatId) : null;
}

export function capabilitiesForActor(
  model: Pick<ActorRoomModelV1, "seats" | "bindings">,
  actorId: string,
): GameCapabilityV1[] {
  const binding = bindingForActor(model, actorId);
  if (!binding) return ["room:view-public"];

  const capabilities: GameCapabilityV1[] = [
    "room:view-public",
    "seat:view-private",
    "seat:inspect-legal",
    "room:comment",
  ];
  const seat = seatById(model, binding.seatId);
  if (!seat) return capabilities;
  if (seat.ownerActorId === actorId) capabilities.push("seat:control");
  if (seat.activeControllerActorId === actorId) capabilities.push("seat:play");
  return capabilities;
}

export function actorHasCapability(
  model: Pick<ActorRoomModelV1, "seats" | "bindings">,
  actorId: string,
  capability: GameCapabilityV1,
): boolean {
  return capabilitiesForActor(model, actorId).includes(capability);
}

export function canActorBecomeController(
  model: Pick<ActorRoomModelV1, "actors" | "seats" | "bindings">,
  seatId: string,
  actorId: string,
): boolean {
  if (!actorById(model, actorId)) return false;
  const binding = bindingForActor(model, actorId);
  return binding?.seatId === seatId;
}

export function validateActorRoomModel(model: ActorRoomModelV1): void {
  if (model.seats.length === 0) throw new Error("At least one game seat is required.");
  if (new Set(model.actors.map((actor) => actor.id)).size !== model.actors.length) {
    throw new Error("Actor IDs must be unique.");
  }
  if (new Set(model.seats.map((seat) => seat.id)).size !== model.seats.length) {
    throw new Error("Seat IDs must be unique.");
  }
  if (new Set(model.bindings.map((binding) => binding.actorId)).size !== model.bindings.length) {
    throw new Error("Each actor may bind to at most one seat in v1.");
  }

  const actorIds = new Set(model.actors.map((actor) => actor.id));
  const seatIds = new Set(model.seats.map((seat) => seat.id));
  for (const seat of model.seats) {
    if (!actorIds.has(seat.ownerActorId)) throw new Error(`Seat ${seat.id} has an unknown owner actor.`);
    if (!actorIds.has(seat.activeControllerActorId)) throw new Error(`Seat ${seat.id} has an unknown controller actor.`);
  }
  for (const binding of model.bindings) {
    if (!actorIds.has(binding.actorId)) throw new Error(`Binding references unknown actor ${binding.actorId}.`);
    if (!seatIds.has(binding.seatId)) throw new Error(`Binding references unknown seat ${binding.seatId}.`);
  }
  for (const seat of model.seats) {
    if (!canActorBecomeController(model, seat.id, seat.ownerActorId)) {
      throw new Error(`Seat ${seat.id} owner must be bound to that seat.`);
    }
    if (!canActorBecomeController(model, seat.id, seat.activeControllerActorId)) {
      throw new Error(`Seat ${seat.id} controller must be bound to that seat.`);
    }
  }
}
