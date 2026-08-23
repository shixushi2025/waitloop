import { historyDelta, recentHistory } from "./game-history.js";
import {
  nextRoomRefreshDelay,
  ROOM_REFRESH_MIN_DELAY_MS,
  roomRefreshSignature,
  shouldRefreshRoom,
} from "./room-refresh-policy.js";

const LEGACY_VIEWER_ID = "you";
const params = new URLSearchParams(window.location.search);
const linkedSessionId = params.get("session");

const roomLabel = document.querySelector("#room-label");
const connectionStatus = document.querySelector("#connection-status");
const gameStart = document.querySelector("#game-start");
const gameView = document.querySelector("#game-view");
const newBotGameButton = document.querySelector("#new-bot-game");
const newConnectedAgentGameButton = document.querySelector("#new-connected-agent-game");
const newCompanionAgentGameButton = document.querySelector("#new-companion-agent-game");
const hostedAgentActions = document.querySelector("#hosted-agent-actions");
const hostedAgentStatus = document.querySelector("#hosted-agent-status");
const createError = document.querySelector("#create-error");
const roleValue = document.querySelector("#role-value");
const turnValue = document.querySelector("#turn-value");
const revisionValue = document.querySelector("#revision-value");
const gameStatusValue = document.querySelector("#game-status-value");
const roomPhaseValue = document.querySelector("#room-phase-value");
const playersElement = document.querySelector("#players");
const currentTrickElement = document.querySelector("#current-trick");
const activityElement = document.querySelector("#activity");
const companionSection = document.querySelector("#companion-section");
const commentsElement = document.querySelector("#comments");
const controlSection = document.querySelector("#control-section");
const controlStatus = document.querySelector("#control-status");
const controlHumanButton = document.querySelector("#control-human");
const controlAgentButton = document.querySelector("#control-agent");
const handElement = document.querySelector("#hand");
const selectionSummary = document.querySelector("#selection-summary");
const playSelectedButton = document.querySelector("#play-selected");
const passMoveButton = document.querySelector("#pass-move");
const hintMoveButton = document.querySelector("#hint-move");
const clearSelectionButton = document.querySelector("#clear-selection");
const gamePrompt = document.querySelector("#game-prompt");
const attention = document.querySelector("#attention");
const attentionTitle = document.querySelector("#attention-title");
const attentionDetail = document.querySelector("#attention-detail");
const resumeButton = document.querySelector("#resume-button");
const mcpSetup = document.querySelector("#mcp-setup");
const joinCommand = document.querySelector("#join-command");
const copyJoinButton = document.querySelector("#copy-join");
const joinLink = document.querySelector("#join-link");
const showMcpButton = document.querySelector("#show-mcp");
const mcpConfigWrap = document.querySelector("#mcp-config-wrap");
const mcpConfig = document.querySelector("#mcp-config");
const copyMcpButton = document.querySelector("#copy-mcp");
const mcpClaimStatus = document.querySelector("#mcp-claim-status");

let roomId = params.get("room");
let snapshot = null;
let roomRefreshTimer = null;
let roomRefreshDelayMs = ROOM_REFRESH_MIN_DELAY_MS;
let turnClockTimer = null;
let sessionSocket = null;
let attentionPauseRequested = false;
let mcpConfigText = "";
let hostedAgents = [];
let createInFlight = false;
let selectionRevision = -1;
let selectedCardIds = new Set();
let hintCursor = 0;
let selectedHintLabel = "";
let presentationActive = false;
let presentationGeneration = 0;
let currentJoinCode = roomId ? sessionStorage.getItem(`waitloop.join.${roomId}`) : null;

function isElement(value) {
  return value instanceof HTMLElement;
}

function rankLabel(rank) {
  return ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "SJ", 17: "BJ" })[rank] ?? String(rank);
}

function isGameSnapshot(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.version === 1 &&
    typeof value.roomId === "string" &&
    typeof value.revision === "number" &&
    typeof value.state === "object" &&
    value.state !== null &&
    typeof value.controls === "object" &&
    value.controls !== null
  );
}

function phaseOf(current) {
  if (typeof current?.roomPhase === "string") return current.roomPhase;
  if (current?.status === "finished") return "finished";
  if (current?.status === "paused") return "paused";
  return "playing";
}

function viewerActorId(current = snapshot) {
  return current?.viewerActorId ?? LEGACY_VIEWER_ID;
}

function viewerSeatId(current = snapshot) {
  return current?.viewerSeatId ?? LEGACY_VIEWER_ID;
}

function actorFor(current, actorId) {
  if (!actorId) return null;
  if (Array.isArray(current?.actors)) {
    const found = current.actors.find((actor) => actor?.id === actorId);
    if (found) return found;
  }
  return Array.isArray(current?.participants)
    ? current.participants.find((participant) => participant?.id === actorId) ?? null
    : null;
}

function seatDescriptor(current, seatId) {
  return Array.isArray(current?.seats)
    ? current.seats.find((seat) => seat?.id === seatId) ?? null
    : null;
}

function bindingForActor(current, actorId) {
  return Array.isArray(current?.bindings)
    ? current.bindings.find((binding) => binding?.actorId === actorId) ?? null
    : null;
}

function actorStateFor(current, actorId) {
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

function connectedActors(current) {
  return Array.isArray(current?.actors)
    ? current.actors.filter((actor) => actor?.kind === "connected-agent")
    : Array.isArray(current?.participants)
      ? current.participants.filter((actor) => actor?.kind === "connected-agent")
      : [];
}

function companionActor(current) {
  const seatId = viewerSeatId(current);
  return connectedActors(current).find((actor) => {
    const binding = bindingForActor(current, actor.id);
    return binding?.seatId === seatId && binding?.relation === "advisor";
  }) ?? null;
}

function controllerActorForSeat(current, seatId) {
  const seat = seatDescriptor(current, seatId);
  if (seat?.activeControllerActorId) return actorFor(current, seat.activeControllerActorId);
  return actorFor(current, seatId);
}

function seatLabel(current, seatId) {
  if (!seatId) return "room";
  const seat = seatDescriptor(current, seatId);
  if (seat?.label) return seat.label;
  if (seatId === viewerSeatId(current)) return "you";
  return actorFor(current, seatId)?.label ?? seatId;
}

function actorLabel(current, actorId) {
  if (!actorId) return "actor";
  if (actorId === viewerActorId(current)) return "you";
  return actorFor(current, actorId)?.label ?? actorId;
}

function canManageRoom(current) {
  return Array.isArray(current?.capabilities) && current.capabilities.includes("room:manage");
}

function updateUrl() {
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set("room", roomId);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

function setConnection(text) {
  if (isElement(connectionStatus)) connectionStatus.textContent = text;
}

function setCreateError(message = "") {
  if (!isElement(createError)) return;
  createError.textContent = message;
  createError.hidden = !message;
}

function setCreateButtonsDisabled(disabled) {
  createInFlight = disabled;
  for (const button of [newBotGameButton, newConnectedAgentGameButton, newCompanionAgentGameButton]) {
    if (button instanceof HTMLButtonElement) button.disabled = disabled;
  }
  if (isElement(hostedAgentActions)) {
    for (const button of hostedAgentActions.querySelectorAll("button")) {
      if (button instanceof HTMLButtonElement) button.disabled = disabled;
    }
  }
}

function formatElapsed(startedAt) {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function currentController(current) {
  return controllerActorForSeat(current, current.currentPlayerId);
}

function promptFor(current) {
  const phase = phaseOf(current);
  if (phase === "waiting_for_players") {
    const connected = connectedActors(current)[0];
    const state = connected ? actorStateFor(current, connected.id) : null;
    if (state?.status === "connecting") return "agent credential claimed · waiting for MCP connection";
    return "waiting for connected agent · no cards are active yet";
  }
  if (current.status === "finished") {
    return current.state.winnerId === viewerSeatId(current)
      ? "you won · return to work when ready"
      : `${seatLabel(current, current.state.winnerId)} won`;
  }
  if (current.status === "paused") return "game paused · work has priority";
  if (presentationActive) return "replaying opponent actions";

  const controller = currentController(current);
  if (current.currentPlayerId === viewerSeatId(current)) {
    if (current.controls?.canPlay === true) return "your turn · select cards, then play";
    if (controller?.kind === "connected-agent") {
      const elapsed = formatElapsed(current.turnStartedAt);
      return `${controller.label} controls your seat${elapsed ? ` · ${elapsed}` : ""}`;
    }
    if (controller?.temporary === true) return "temporary bot controls your seat · restore owner when ready";
    return "your seat is delegated";
  }
  if (controller?.kind === "connected-agent") {
    const elapsed = formatElapsed(current.turnStartedAt);
    const slow = Number.isFinite(current.turnStartedAt) && Date.now() - current.turnStartedAt >= 60_000;
    return `${controller.label} turn${elapsed ? ` · ${elapsed}` : ""}${slow ? " · taking a little longer" : ""}`;
  }
  if (controller?.kind === "hosted-agent") return `${controller.label} is thinking`;
  if (controller?.temporary === true) return `${seatLabel(current, current.currentPlayerId)} · temporary bot moving`;
  return `${seatLabel(current, current.currentPlayerId)} is moving`;
}

function playerRuntimeText(current, seatId) {
  const controller = controllerActorForSeat(current, seatId);
  const state = controller ? actorStateFor(current, controller.id) : null;
  if (phaseOf(current) === "waiting_for_players") {
    if (controller?.kind === "connected-agent") {
      if (state?.status === "connecting") return "CONNECTING";
      if (state?.status === "connected") return "READY";
      return "WAITING";
    }
    return "READY";
  }

  if (controller?.temporary === true) {
    return current.currentPlayerId === seatId ? "TURN · BOT TAKEOVER" : "BOT TAKEOVER";
  }
  const controlledBy = controller ? actorLabel(current, controller.id) : "unknown";
  if (current.currentPlayerId === seatId && controller?.kind === "connected-agent") {
    const elapsed = formatElapsed(current.turnStartedAt);
    const slow = Number.isFinite(current.turnStartedAt) && Date.now() - current.turnStartedAt >= 60_000;
    return `TURN · ${controlledBy}${elapsed ? ` · ${elapsed}` : ""}${slow ? " · SLOW" : ""}`;
  }
  if (current.currentPlayerId === seatId) return `TURN · ${controlledBy}`;
  if (controller?.kind === "connected-agent" && state?.status === "connected") return `CONTROL · ${controlledBy}`;
  return controlledBy === seatLabel(current, seatId) ? "READY" : `CONTROL · ${controlledBy}`;
}

function managementActionForSeat(current, seatId) {
  if (!canManageRoom(current) || phaseOf(current) === "waiting_for_players") return null;
  const seat = seatDescriptor(current, seatId);
  if (!seat) return null;
  const owner = actorFor(current, seat.ownerActorId);
  const controller = controllerActorForSeat(current, seatId);
  if (owner?.kind !== "human" && owner?.kind !== "connected-agent") return null;
  if (controller?.temporary === true) {
    const ownerState = actorStateFor(current, owner.id);
    return {
      action: "owner",
      label: owner.kind === "connected-agent" ? "restore agent" : "restore owner",
      disabled: owner.kind === "connected-agent" && ownerState?.status !== "connected",
    };
  }
  return {
    action: "bot",
    label: seatId === viewerSeatId(current) ? "let bot play" : "replace with bot",
    disabled: false,
  };
}

function renderPlayers(current) {
  if (!isElement(playersElement)) return;
  playersElement.replaceChildren();
  const waiting = phaseOf(current) === "waiting_for_players";

  for (const player of current.state.players ?? []) {
    const seat = seatDescriptor(current, player.id);
    const controller = controllerActorForSeat(current, player.id);
    const row = document.createElement("div");
    const isTurn = !waiting && current.currentPlayerId === player.id;
    row.className = `player${isTurn ? " current" : ""}`;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = seatLabel(current, player.id);

    const role = document.createElement("span");
    role.className = "role";
    const kind = controller?.temporary === true ? "temporary-bot" : controller?.kind ?? "player";
    role.textContent = waiting ? `pending · ${kind}` : `${player.role} · ${kind}`;
    if (seat?.ownerActorId && seat.ownerActorId !== seat.activeControllerActorId) {
      role.title = `seat owner: ${actorLabel(current, seat.ownerActorId)}`;
    }

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = waiting ? "-- cards" : `${player.remaining} cards`;

    const runtime = document.createElement("span");
    runtime.className = "runtime";
    const runtimeState = document.createElement("span");
    runtimeState.textContent = playerRuntimeText(current, player.id);
    runtime.append(runtimeState);

    const manage = managementActionForSeat(current, player.id);
    if (manage) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button seat-fallback-button";
      button.textContent = manage.label;
      button.disabled = manage.disabled;
      if (manage.disabled) button.title = "seat owner must reconnect first";
      button.addEventListener("click", () => void setSeatFallback(player.id, manage.action));
      runtime.append(button);
    }

    row.append(name, role, count, runtime);
    playersElement.append(row);
  }
}

function actionText(current, entry) {
  const name = seatLabel(current, entry?.playerId);
  if (entry?.type === "pass") return `${name}  pass`;
  const cards = Array.isArray(entry?.cards) ? entry.cards.map((card) => rankLabel(card.rank)).join(" ") : "";
  return `${name}  ${entry?.pattern?.kind ?? "play"}  ${cards}`.trim();
}

function renderCurrentTrick(current) {
  if (!isElement(currentTrickElement)) return;
  currentTrickElement.classList.remove("replaying");
  if (phaseOf(current) === "waiting_for_players") {
    currentTrickElement.textContent = "waiting · table opens when the connected actor arrives";
    return;
  }
  const last = current.state.lastPlay;
  currentTrickElement.textContent = last ? actionText(current, last) : "open trick · leader may play any legal pattern";
}

function renderActivity(current) {
  if (!isElement(activityElement)) return;
  activityElement.replaceChildren();
  const history = Array.isArray(current.state.history) ? current.state.history : [];
  const items = recentHistory(current, 6);
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = phaseOf(current) === "waiting_for_players" ? "game has not started" : "no actions yet";
    activityElement.append(empty);
    return;
  }

  const offset = history.length - items.length;
  items.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "activity-row";
    const number = document.createElement("span");
    number.className = "activity-number";
    number.textContent = String(offset + index + 1).padStart(2, "0");
    const text = document.createElement("span");
    text.textContent = actionText(current, entry);
    row.append(number, text);
    activityElement.append(row);
  });
}

function renderComments(current) {
  if (!isElement(companionSection) || !isElement(commentsElement)) return;
  const hasCompanion = Boolean(companionActor(current));
  const comments = Array.isArray(current.comments) ? current.comments.slice(-6) : [];
  companionSection.hidden = !hasCompanion && comments.length === 0;
  commentsElement.replaceChildren();
  if (comments.length === 0) {
    const empty = document.createElement("div");
    empty.className = "comment-empty";
    empty.textContent = hasCompanion ? "agent connected · no comments yet" : "no comments";
    commentsElement.append(empty);
    return;
  }
  for (const comment of comments) {
    const row = document.createElement("div");
    row.className = "comment-row";
    const who = document.createElement("span");
    who.className = "comment-actor";
    who.textContent = actorLabel(current, comment.actorId);
    const text = document.createElement("span");
    text.textContent = comment.text ?? "";
    row.append(who, text);
    commentsElement.append(row);
  }
}

function renderControl(current) {
  if (!isElement(controlSection) || !isElement(controlStatus)) return;
  const canControl = Array.isArray(current.capabilities) && current.capabilities.includes("seat:control");
  const companion = companionActor(current);
  if (!canControl || !companion) {
    controlSection.hidden = true;
    return;
  }
  controlSection.hidden = false;
  const seat = seatDescriptor(current, viewerSeatId(current));
  const activeId = seat?.activeControllerActorId ?? viewerActorId(current);
  const humanActive = activeId === viewerActorId(current);
  const companionState = actorStateFor(current, companion.id);
  controlStatus.textContent = humanActive
    ? `${actorLabel(current, viewerActorId(current))} control this seat · ${companion.label} advises`
    : `${actorLabel(current, activeId)} controls this seat · you can take back control anytime`;
  if (controlHumanButton instanceof HTMLButtonElement) controlHumanButton.disabled = humanActive;
  if (controlAgentButton instanceof HTMLButtonElement) {
    controlAgentButton.disabled = !humanActive || companionState?.status !== "connected";
    controlAgentButton.title = companionState?.status === "connected" ? "delegate this seat" : "agent must connect first";
  }
}

function isHumanTurn(current = snapshot) {
  return Boolean(
    current &&
    !presentationActive &&
    phaseOf(current) === "playing" &&
    current.status === "playing" &&
    current.currentPlayerId === viewerSeatId(current) &&
    current.controls?.canPlay === true,
  );
}

function selectedCards(current = snapshot) {
  if (!current || !Array.isArray(current.state?.myHand)) return [];
  return current.state.myHand.filter((card) => selectedCardIds.has(card.id));
}

function syncSelection(current) {
  if (selectionRevision !== current.revision) {
    selectedCardIds = new Set();
    selectionRevision = current.revision;
    hintCursor = 0;
    selectedHintLabel = "";
  }
  const currentIds = new Set((current.state.myHand ?? []).map((card) => card.id));
  for (const id of selectedCardIds) if (!currentIds.has(id)) selectedCardIds.delete(id);
  if (!isHumanTurn(current) && selectedCardIds.size > 0) {
    selectedCardIds.clear();
    hintCursor = 0;
    selectedHintLabel = "";
  }
}

function renderHand(current) {
  if (!isElement(handElement)) return;
  handElement.replaceChildren();
  if (phaseOf(current) === "waiting_for_players") {
    const note = document.createElement("span");
    note.className = "hand-waiting";
    note.textContent = "cards unlock when the connected actor is ready";
    handElement.append(note);
    return;
  }

  const selectable = isHumanTurn(current);
  for (const card of current.state.myHand ?? []) {
    const token = document.createElement("button");
    token.type = "button";
    token.className = `card-token${selectedCardIds.has(card.id) ? " selected" : ""}`;
    token.textContent = rankLabel(card.rank);
    token.title = selectable
      ? `click to ${selectedCardIds.has(card.id) ? "deselect" : "select"}`
      : current.controls?.canPlay === false ? "seat control is delegated" : "waiting for your turn";
    token.disabled = !selectable;
    token.setAttribute("aria-pressed", selectedCardIds.has(card.id) ? "true" : "false");
    token.addEventListener("click", () => {
      if (!snapshot || !isHumanTurn(snapshot)) return;
      if (selectedCardIds.has(card.id)) selectedCardIds.delete(card.id);
      else selectedCardIds.add(card.id);
      selectedHintLabel = "";
      renderHand(snapshot);
      renderActions(snapshot);
    });
    handElement.append(token);
  }
}

function setActionDisabled(button, disabled) {
  if (button instanceof HTMLButtonElement) button.disabled = disabled;
}

function renderActions(current) {
  if (!isElement(selectionSummary)) return;
  selectionSummary.classList.remove("valid", "invalid");
  if (phaseOf(current) === "waiting_for_players") {
    for (const button of [playSelectedButton, passMoveButton, hintMoveButton, clearSelectionButton]) setActionDisabled(button, true);
    selectionSummary.textContent = "waiting for connected actor · no turn timer";
    return;
  }

  const turn = isHumanTurn(current);
  const cards = selectedCards(current);
  const canPass = current.controls?.canPass === true;
  const canHint = current.controls?.canHint === true;
  setActionDisabled(playSelectedButton, !turn || cards.length === 0);
  setActionDisabled(passMoveButton, !turn || !canPass);
  setActionDisabled(hintMoveButton, !turn || !canHint);
  setActionDisabled(clearSelectionButton, cards.length === 0 || presentationActive);

  if (presentationActive) {
    selectionSummary.textContent = "showing opponent actions";
    return;
  }
  if (current.controls?.canPlay === false && current.currentPlayerId === viewerSeatId(current)) {
    const controller = controllerActorForSeat(current, viewerSeatId(current));
    selectionSummary.textContent = controller?.temporary === true
      ? "temporary bot controls your seat · restore owner when ready"
      : "agent controls your seat · take control to play yourself";
    return;
  }
  if (!turn) {
    selectionSummary.textContent = current.status === "paused" ? "paused" : "no input required";
    return;
  }
  if (cards.length === 0) {
    selectionSummary.textContent = "select cards from hand";
    return;
  }
  const labels = cards.map((card) => rankLabel(card.rank)).join(" ");
  selectionSummary.textContent = selectedHintLabel ? `${labels} · hint: ${selectedHintLabel}` : `${labels} · ${cards.length} selected`;
}

function clearSelection() {
  selectedCardIds.clear();
  hintCursor = 0;
  selectedHintLabel = "";
  if (snapshot) {
    renderHand(snapshot);
    renderActions(snapshot);
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function renderNow(current) {
  roomId = current.roomId;
  updateUrl();
  syncSelection(current);
  const phase = phaseOf(current);
  if (isElement(roomLabel)) roomLabel.textContent = `room / ${roomId.slice(0, 18)}`;
  if (isElement(gameStart)) gameStart.hidden = true;
  if (isElement(gameView)) gameView.hidden = false;
  if (isElement(roleValue)) roleValue.textContent = phase === "waiting_for_players" ? "pending" : current.state.role ?? "-";
  if (isElement(turnValue)) turnValue.textContent = phase === "waiting_for_players" ? "waiting" : seatLabel(current, current.currentPlayerId);
  if (isElement(revisionValue)) revisionValue.textContent = String(current.revision);
  if (isElement(gameStatusValue)) gameStatusValue.textContent = current.status;
  if (isElement(roomPhaseValue)) roomPhaseValue.textContent = phase;
  if (isElement(gamePrompt)) gamePrompt.textContent = promptFor(current);

  renderPlayers(current);
  renderControl(current);
  renderCurrentTrick(current);
  renderActivity(current);
  renderComments(current);
  renderHand(current);
  renderActions(current);
  scheduleRoomRefresh(current);
  scheduleTurnClock(current);
  updateConnectedSetup(current);
}

async function playPresentation(entries, current, generation) {
  if (!isElement(currentTrickElement) || entries.length === 0) return;
  presentationActive = true;
  renderActions(current);
  for (const entry of entries) {
    if (generation !== presentationGeneration) return;
    currentTrickElement.classList.add("replaying");
    currentTrickElement.textContent = `→ ${actionText(current, entry)}`;
    if (isElement(gamePrompt)) gamePrompt.textContent = "replaying opponent actions";
    await new Promise((resolve) => window.setTimeout(resolve, 700));
  }
  if (generation !== presentationGeneration) return;
  presentationActive = false;
  renderCurrentTrick(current);
  renderActions(current);
  if (isElement(gamePrompt)) gamePrompt.textContent = promptFor(current);
}

function render(current) {
  const previous = snapshot;
  if (!previous || roomRefreshSignature(previous) !== roomRefreshSignature(current)) {
    roomRefreshDelayMs = ROOM_REFRESH_MIN_DELAY_MS;
  }
  const delta = previous ? historyDelta(previous, current) : [];
  snapshot = current;
  presentationGeneration += 1;
  presentationActive = false;
  renderNow(current);

  const opponentActions = delta.filter((entry) => entry?.playerId !== viewerSeatId(current));
  if (opponentActions.length > 0 && phaseOf(current) === "playing") {
    const generation = presentationGeneration;
    void playPresentation(opponentActions, current, generation);
  }
}

async function refreshRoom({ quiet = false } = {}) {
  if (!roomId) return false;
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) throw new Error(body?.error?.message ?? "room unavailable");
    render(body.snapshot);
    if (!quiet) setConnection(phaseOf(body.snapshot) === "waiting_for_players" ? "waiting for agent" : "live");
    return true;
  } catch (error) {
    if (!quiet) {
      setConnection("room unavailable");
      if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "room unavailable";
    }
    return false;
  }
}

function stopRoomRefresh() {
  window.clearTimeout(roomRefreshTimer);
  roomRefreshTimer = null;
}

function scheduleRoomRefresh(current) {
  stopRoomRefresh();
  if (!roomId || !shouldRefreshRoom(current, !document.hidden)) return;
  const scheduledSignature = roomRefreshSignature(current);
  const delayMs = roomRefreshDelayMs;
  roomRefreshTimer = window.setTimeout(async () => {
    const ok = await refreshRoom({ quiet: true });
    if (!snapshot) return;
    const changed = ok && roomRefreshSignature(snapshot) !== scheduledSignature;
    roomRefreshDelayMs = nextRoomRefreshDelay(roomRefreshDelayMs, changed);
    scheduleRoomRefresh(snapshot);
  }, delayMs);
}

function scheduleTurnClock(current) {
  window.clearInterval(turnClockTimer);
  turnClockTimer = null;
  const controller = currentController(current);
  if (phaseOf(current) !== "playing" || controller?.kind !== "connected-agent") return;
  turnClockTimer = window.setInterval(() => {
    if (!snapshot) return;
    renderPlayers(snapshot);
    renderControl(snapshot);
    if (isElement(gamePrompt)) gamePrompt.textContent = promptFor(snapshot);
  }, 1000);
}

async function playSelection() {
  if (!roomId || !snapshot || !isHumanTurn(snapshot)) return;
  const cards = selectedCards(snapshot);
  if (cards.length === 0) return;
  const expectedRevision = snapshot.revision;
  try {
    setActionDisabled(playSelectedButton, true);
    setConnection("opponents moving");
    if (isElement(gamePrompt)) gamePrompt.textContent = "checking selected cards";
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/play`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1, expectedRevision, cardIds: cards.map((card) => card.id) }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) throw new Error(body?.error?.message ?? "play rejected");
    render(body.snapshot);
    setConnection("live");
  } catch (error) {
    setConnection("play rejected");
    if (isElement(selectionSummary)) {
      selectionSummary.classList.add("invalid");
      selectionSummary.textContent = error instanceof Error ? error.message : "selected cards are not legal";
    }
    if (isElement(gamePrompt)) gamePrompt.textContent = "adjust your selection";
    void refreshRoom({ quiet: true });
  } finally {
    if (snapshot) renderActions(snapshot);
  }
}

async function passTurn() {
  if (!roomId || !snapshot || !isHumanTurn(snapshot) || snapshot.controls?.canPass !== true) return;
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/pass`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1, expectedRevision: snapshot.revision }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) throw new Error(body?.error?.message ?? "pass rejected");
    render(body.snapshot);
    setConnection("live");
  } catch (error) {
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "pass rejected";
    void refreshRoom({ quiet: true });
  }
}

async function requestHint() {
  if (!roomId || !snapshot || !isHumanTurn(snapshot) || snapshot.controls?.canHint !== true) return;
  const expectedRevision = snapshot.revision;
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/hint`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1, expectedRevision, cursor: hintCursor }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !body?.hint || !Array.isArray(body.hint.cardIds)) throw new Error(body?.error?.message ?? "hint unavailable");
    selectedCardIds = new Set(body.hint.cardIds);
    selectionRevision = expectedRevision;
    hintCursor = Number.isSafeInteger(body.hint.index) ? body.hint.index + 1 : hintCursor + 1;
    selectedHintLabel = typeof body.hint.label === "string" ? body.hint.label : "suggested play";
    renderHand(snapshot);
    renderActions(snapshot);
  } catch (error) {
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "hint unavailable";
    void refreshRoom({ quiet: true });
  }
}

async function setController(targetActorId) {
  if (!roomId || !snapshot || typeof targetActorId !== "string") return;
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/control`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1, targetActorId }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) throw new Error(body?.error?.message ?? "control change rejected");
    clearSelection();
    render(body.snapshot);
    setConnection("live");
  } catch (error) {
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "control change rejected";
    void refreshRoom({ quiet: true });
  }
}

async function setSeatFallback(targetSeatId, action) {
  if (!roomId || !snapshot || (action !== "bot" && action !== "owner")) return;
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/fallback`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1, targetSeatId, action }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) throw new Error(body?.error?.message ?? "fallback change rejected");
    clearSelection();
    render(body.snapshot);
    setConnection("live");
  } catch (error) {
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "fallback change rejected";
    void refreshRoom({ quiet: true });
  }
}

function rememberJoinCode(code) {
  currentJoinCode = code;
  if (roomId && code) sessionStorage.setItem(`waitloop.join.${roomId}`, code);
}

function showConnectedSetup(code, joinUrl) {
  if (!isElement(mcpSetup) || typeof code !== "string") return;
  const command = `waitloop join ${code}`;
  if (isElement(joinCommand)) joinCommand.textContent = command;
  if (joinLink instanceof HTMLAnchorElement) {
    joinLink.href = joinUrl ?? `/join/${encodeURIComponent(code)}`;
    joinLink.textContent = joinUrl ?? `${window.location.origin}/join/${code}`;
  }
  if (isElement(mcpClaimStatus)) mcpClaimStatus.textContent = "CLI, join URL, or raw MCP · same room capability";
  if (isElement(mcpConfigWrap)) mcpConfigWrap.hidden = true;
  mcpSetup.hidden = false;
}

function updateConnectedSetup(current) {
  if (!isElement(mcpSetup)) return;
  const connected = connectedActors(current);
  if (connected.length === 0) {
    mcpSetup.hidden = true;
    return;
  }
  if (currentJoinCode) showConnectedSetup(currentJoinCode, `/join/${encodeURIComponent(currentJoinCode)}`);
  const state = actorStateFor(current, connected[0].id);
  if (isElement(mcpClaimStatus) && state?.status === "connected") mcpClaimStatus.textContent = "agent connected";
  else if (isElement(mcpClaimStatus) && state?.status === "disconnected") mcpClaimStatus.textContent = "agent away · temporary control may continue";
  else if (isElement(mcpClaimStatus) && state?.status === "connecting") mcpClaimStatus.textContent = "credential claimed · waiting for MCP client";
}

async function claimRawMcp() {
  if (!currentJoinCode || !isElement(mcpConfig) || !isElement(mcpConfigWrap)) return;
  if (showMcpButton instanceof HTMLButtonElement) showMcpButton.disabled = true;
  try {
    const response = await fetch(`/api/v1/join/${encodeURIComponent(currentJoinCode)}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !body?.mcp) throw new Error(body?.error?.message ?? "could not claim MCP actor");
    mcpConfigText = JSON.stringify({ mcpServers: { waitloop: body.mcp } }, null, 2);
    mcpConfig.textContent = mcpConfigText;
    mcpConfigWrap.hidden = false;
    if (isElement(mcpClaimStatus)) mcpClaimStatus.textContent = `${body.relation ?? "controller"} credential issued · connect this MCP config`;
    void refreshRoom({ quiet: true });
  } catch (error) {
    if (isElement(mcpClaimStatus)) mcpClaimStatus.textContent = error instanceof Error ? error.message : "MCP claim failed";
  } finally {
    if (showMcpButton instanceof HTMLButtonElement) showMcpButton.disabled = false;
  }
}

async function loadRoom() {
  if (!roomId) return false;
  currentJoinCode = sessionStorage.getItem(`waitloop.join.${roomId}`);
  const ok = await refreshRoom();
  if (!ok) setCreateError("This browser cannot recover access to that room, or the room has expired.");
  return ok;
}

async function createRoom(mode, hostedAgentId) {
  if (createInFlight) return;
  setCreateButtonsDisabled(true);
  setCreateError("");
  setConnection("creating room");
  if (isElement(mcpSetup)) mcpSetup.hidden = true;
  mcpConfigText = "";
  currentJoinCode = null;
  selectedCardIds.clear();
  selectionRevision = -1;
  hintCursor = 0;
  selectedHintLabel = "";

  const payload = { version: 1, gameId: "doudizhu", mode };
  if (mode === "hosted-agent") payload.hostedAgentId = hostedAgentId;
  try {
    const response = await fetch("/api/v1/rooms", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) throw new Error(body?.error?.message ?? "could not create room");
    roomId = body.roomId;
    if ((mode === "connected-agent" || mode === "companion-agent") && typeof body.joinCode === "string") {
      rememberJoinCode(body.joinCode);
      showConnectedSetup(body.joinCode, typeof body.joinUrl === "string" ? body.joinUrl : undefined);
    }
    render(body.snapshot);
    setConnection(phaseOf(body.snapshot) === "waiting_for_players" ? "waiting for agent" : "live");
  } catch (error) {
    const message = error instanceof Error ? error.message : "create failed";
    setConnection("create failed");
    setCreateError(message);
    if (isElement(gamePrompt)) gamePrompt.textContent = message;
  } finally {
    setCreateButtonsDisabled(false);
  }
}

async function setPaused(paused) {
  if (!roomId || !snapshot) return;
  const action = paused ? "pause" : "resume";
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    const body = await readJsonResponse(response);
    if (response.ok && isGameSnapshot(body?.snapshot)) render(body.snapshot);
  } catch {
    // Agent attention remains visible even if pause delivery fails.
  }
}

function handleAgentSnapshot(agent) {
  if (!isElement(attention) || !isElement(attentionTitle) || !isElement(attentionDetail)) return;
  const interrupts = agent.state === "waiting" || agent.state === "completed" || agent.state === "failed";
  if (!interrupts) {
    if (agent.state === "running" && attentionPauseRequested) {
      attention.hidden = false;
      attentionTitle.textContent = "agent running again";
      attentionDetail.textContent = "game remains paused until you resume it";
      if (resumeButton instanceof HTMLButtonElement) resumeButton.hidden = false;
    } else attention.hidden = true;
    return;
  }
  attention.hidden = false;
  attentionTitle.textContent = agent.state === "waiting" ? "agent needs attention" : `agent ${agent.state}`;
  attentionDetail.textContent = "game paused · work comes first";
  if (resumeButton instanceof HTMLButtonElement) resumeButton.hidden = true;
  if (!attentionPauseRequested) {
    attentionPauseRequested = true;
    void setPaused(true);
  }
}

function connectAgentSession() {
  if (!linkedSessionId) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  sessionSocket = new WebSocket(`${protocol}//${window.location.host}/api/v1/sessions/${encodeURIComponent(linkedSessionId)}/ws`);
  sessionSocket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data);
      if (message?.version === 1 && message?.type === "agent.snapshot" && message.snapshot) handleAgentSnapshot(message.snapshot);
    } catch {
      // Ignore malformed lifecycle messages.
    }
  });
}

async function loadHostedAgents() {
  if (!isElement(hostedAgentActions) || !isElement(hostedAgentStatus)) return;
  try {
    const response = await fetch("/api/v1/hosted-agents", { headers: { accept: "application/json" } });
    const body = await readJsonResponse(response);
    hostedAgents = response.ok && Array.isArray(body?.agents) ? body.agents : [];
  } catch {
    hostedAgents = [];
  }
  hostedAgentActions.replaceChildren();
  if (hostedAgents.length === 0) {
    hostedAgentStatus.textContent = "No hosted model is configured on this deployment yet.";
    return;
  }
  for (const hosted of hostedAgents) {
    if (!hosted || typeof hosted.id !== "string" || typeof hosted.label !== "string") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-button";
    button.title = typeof hosted.model === "string" ? hosted.model : hosted.label;
    const prompt = document.createElement("span");
    prompt.textContent = ">";
    button.append(prompt, document.createTextNode(` you + ${hosted.label} + bot`));
    button.addEventListener("click", () => void createRoom("hosted-agent", hosted.id));
    hostedAgentActions.append(button);
  }
  hostedAgentStatus.textContent = "Hosted by Waitloop. Only that seat's visible game state is sent to the model provider.";
}

newBotGameButton?.addEventListener("click", () => void createRoom("bots"));
newConnectedAgentGameButton?.addEventListener("click", () => void createRoom("connected-agent"));
newCompanionAgentGameButton?.addEventListener("click", () => void createRoom("companion-agent"));
playSelectedButton?.addEventListener("click", () => void playSelection());
passMoveButton?.addEventListener("click", () => void passTurn());
hintMoveButton?.addEventListener("click", () => void requestHint());
clearSelectionButton?.addEventListener("click", clearSelection);
showMcpButton?.addEventListener("click", () => void claimRawMcp());
controlHumanButton?.addEventListener("click", () => {
  if (snapshot) void setController(viewerActorId(snapshot));
});
controlAgentButton?.addEventListener("click", () => {
  if (!snapshot) return;
  const companion = companionActor(snapshot);
  if (companion) void setController(companion.id);
});
copyJoinButton?.addEventListener("click", async () => {
  if (!currentJoinCode) return;
  try {
    await navigator.clipboard.writeText(`waitloop join ${currentJoinCode}`);
    if (copyJoinButton instanceof HTMLButtonElement) copyJoinButton.textContent = "copied";
  } catch {
    if (copyJoinButton instanceof HTMLButtonElement) copyJoinButton.textContent = "copy failed";
  }
});
copyMcpButton?.addEventListener("click", async () => {
  if (!mcpConfigText) return;
  try {
    await navigator.clipboard.writeText(mcpConfigText);
    if (copyMcpButton instanceof HTMLButtonElement) copyMcpButton.textContent = "copied";
  } catch {
    if (copyMcpButton instanceof HTMLButtonElement) copyMcpButton.textContent = "copy failed";
  }
});
resumeButton?.addEventListener("click", () => {
  attentionPauseRequested = false;
  if (isElement(attention)) attention.hidden = true;
  void setPaused(false);
});

document.addEventListener("keydown", (event) => {
  if (!snapshot || !isHumanTurn(snapshot) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "Enter" && selectedCardIds.size > 0) {
    event.preventDefault();
    void playSelection();
  } else if (event.key.toLowerCase() === "h" && snapshot.controls?.canHint === true) {
    event.preventDefault();
    void requestHint();
  } else if (event.key.toLowerCase() === "p" && snapshot.controls?.canPass === true) {
    event.preventDefault();
    void passTurn();
  } else if (event.key === "Escape") {
    event.preventDefault();
    clearSelection();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRoomRefresh();
    return;
  }
  roomRefreshDelayMs = ROOM_REFRESH_MIN_DELAY_MS;
  if (roomId) void refreshRoom({ quiet: true });
});

window.addEventListener("pagehide", () => {
  stopRoomRefresh();
  window.clearInterval(turnClockTimer);
});

if (roomId) void loadRoom();
void loadHostedAgents();
connectAgentSession();
