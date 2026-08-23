export const ROOM_REFRESH_MIN_DELAY_MS = 1000;
export const ROOM_REFRESH_MAX_DELAY_MS = 10000;

function phaseOf(current) {
  if (typeof current?.roomPhase === "string") return current.roomPhase;
  if (current?.status === "finished") return "finished";
  if (current?.status === "paused") return "paused";
  return "playing";
}

function connectedActors(current) {
  const actors = Array.isArray(current?.actors)
    ? current.actors
    : Array.isArray(current?.participants)
      ? current.participants
      : [];
  return actors.filter((actor) => actor?.kind === "connected-agent");
}

export function shouldRefreshRoom(current, visible = true) {
  if (!visible || !current || current.status === "finished") return false;
  return phaseOf(current) === "waiting_for_players" || connectedActors(current).length > 0;
}

export function nextRoomRefreshDelay(currentDelay, changed) {
  if (changed) return ROOM_REFRESH_MIN_DELAY_MS;
  const normalized = Number.isSafeInteger(currentDelay) && currentDelay > 0
    ? currentDelay
    : ROOM_REFRESH_MIN_DELAY_MS;
  return Math.min(ROOM_REFRESH_MAX_DELAY_MS, Math.max(ROOM_REFRESH_MIN_DELAY_MS, normalized * 2));
}

export function roomRefreshSignature(current) {
  if (!current || typeof current !== "object") return "";
  const actors = (Array.isArray(current.actors) ? current.actors : [])
    .filter((actor) => actor && typeof actor.id === "string")
    .map((actor) => {
      const runtime = Array.isArray(current.actorStates)
        ? current.actorStates.find((state) => state?.actorId === actor.id)
        : null;
      return [actor.id, actor.kind ?? "", runtime?.status ?? ""];
    });
  const seats = (Array.isArray(current.seats) ? current.seats : [])
    .filter((seat) => seat && typeof seat.id === "string")
    .map((seat) => [seat.id, seat.activeControllerActorId ?? ""]);
  const comments = Array.isArray(current.comments) ? current.comments : [];
  const lastComment = comments.at(-1);
  return JSON.stringify({
    revision: current.revision ?? null,
    status: current.status ?? null,
    roomPhase: phaseOf(current),
    currentPlayerId: current.currentPlayerId ?? null,
    actors,
    seats,
    commentCount: comments.length,
    lastCommentId: lastComment?.id ?? null,
  });
}
