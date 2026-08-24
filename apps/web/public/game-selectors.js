const LEGACY_VIEWER_ID = "you";

export function phaseOf(current) {
  if (typeof current?.roomPhase === "string") return current.roomPhase;
  if (current?.status === "finished") return "finished";
  if (current?.status === "paused") return "paused";
  return "playing";
}

export function viewerActorId(current) {
  return current?.viewerActorId ?? LEGACY_VIEWER_ID;
}

export function viewerSeatId(current) {
  return current?.viewerSeatId ?? LEGACY_VIEWER_ID;
}

export function actorFor(current, actorId) {
  if (!actorId) return null;
  if (Array.isArray(current?.actors)) {
    const found = current.actors.find((actor) => actor?.id === actorId);
    if (found) return found;
  }
  return Array.isArray(current?.participants)
    ? current.participants.find((participant) => participant?.id === actorId) ?? null
    : null;
}

export function seatDescriptor(current, seatId) {
  return Array.isArray(current?.seats)
    ? current.seats.find((seat) => seat?.id === seatId) ?? null
    : null;
}

export function bindingForActor(current, actorId) {
  return Array.isArray(current?.bindings)
    ? current.bindings.find((binding) => binding?.actorId === actorId) ?? null
    : null;
}

export function actorStateFor(current, actorId) {
  if (Array.isArray(current?.actorStates)) {
    const found = current.actorStates.find((state) => state?.actorId === actorId);
    if (found) return found;
  }
  if (Array.isArray(current?.seatStates)) {
    const legacy = current.seatStates.find((state) => state?.playerId === actorId);
    if (legacy) return legacy;
  }
  return null;
}

export function connectedActors(current) {
  return Array.isArray(current?.actors)
    ? current.actors.filter((actor) => actor?.kind === "connected-agent")
    : Array.isArray(current?.participants)
      ? current.participants.filter((actor) => actor?.kind === "connected-agent")
      : [];
}

export function companionActor(current) {
  const seatId = viewerSeatId(current);
  return connectedActors(current).find((actor) => {
    const binding = bindingForActor(current, actor.id);
    return binding?.seatId === seatId && binding?.relation === "advisor";
  }) ?? null;
}

export function controllerActorForSeat(current, seatId) {
  const seat = seatDescriptor(current, seatId);
  if (seat?.activeControllerActorId) return actorFor(current, seat.activeControllerActorId);
  return actorFor(current, seatId);
}

export function seatLabel(current, seatId) {
  if (!seatId) return "room";
  const seat = seatDescriptor(current, seatId);
  if (seat?.label) return seat.label;
  if (seatId === viewerSeatId(current)) return "you";
  return actorFor(current, seatId)?.label ?? seatId;
}

export function actorLabel(current, actorId) {
  if (!actorId) return "actor";
  if (actorId === viewerActorId(current)) return "you";
  return actorFor(current, actorId)?.label ?? actorId;
}

export function canManageRoom(current) {
  return Array.isArray(current?.capabilities) && current.capabilities.includes("room:manage");
}
