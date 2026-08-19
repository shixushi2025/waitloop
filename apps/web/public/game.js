const VIEWER_ID = "you";
const params = new URLSearchParams(window.location.search);
const linkedSessionId = params.get("session");

const roomLabel = document.querySelector("#room-label");
const connectionStatus = document.querySelector("#connection-status");
const gameStart = document.querySelector("#game-start");
const gameView = document.querySelector("#game-view");
const newBotGameButton = document.querySelector("#new-bot-game");
const newConnectedAgentGameButton = document.querySelector("#new-connected-agent-game");
const hostedAgentActions = document.querySelector("#hosted-agent-actions");
const hostedAgentStatus = document.querySelector("#hosted-agent-status");
const createError = document.querySelector("#create-error");
const roleValue = document.querySelector("#role-value");
const turnValue = document.querySelector("#turn-value");
const revisionValue = document.querySelector("#revision-value");
const gameStatusValue = document.querySelector("#game-status-value");
const playersElement = document.querySelector("#players");
const lastMoveElement = document.querySelector("#last-move");
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
const mcpConfig = document.querySelector("#mcp-config");
const copyMcpButton = document.querySelector("#copy-mcp");

let roomId = params.get("room");
let snapshot = null;
let roomRefreshTimer = null;
let sessionSocket = null;
let attentionPauseRequested = false;
let mcpConfigText = "";
let hostedAgents = [];
let createInFlight = false;
let selectionRevision = -1;
let selectedCardIds = new Set();
let hintCursor = 0;
let selectedHintLabel = "";

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

function participantFor(current, playerId) {
  return Array.isArray(current?.participants)
    ? current.participants.find((participant) => participant?.id === playerId) ?? null
    : null;
}

function playerLabel(current, playerId) {
  if (!playerId) return "room";
  if (playerId === VIEWER_ID) return "you";
  return participantFor(current, playerId)?.label ?? playerId;
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
  if (newBotGameButton instanceof HTMLButtonElement) newBotGameButton.disabled = disabled;
  if (newConnectedAgentGameButton instanceof HTMLButtonElement) newConnectedAgentGameButton.disabled = disabled;
  if (isElement(hostedAgentActions)) {
    for (const button of hostedAgentActions.querySelectorAll("button")) {
      if (button instanceof HTMLButtonElement) button.disabled = disabled;
    }
  }
}

function promptFor(current) {
  if (current.status === "finished") {
    return current.state.winnerId === VIEWER_ID
      ? "you won · return to work when ready"
      : `${playerLabel(current, current.state.winnerId)} won`;
  }
  if (current.status === "paused") return "game paused · work has priority";
  if (current.currentPlayerId === VIEWER_ID) return "your turn · select cards, then play";

  const participant = participantFor(current, current.currentPlayerId);
  if (participant?.kind === "connected-agent") return `${participant.label} turn · waiting for MCP move`;
  if (participant?.kind === "hosted-agent") return `${participant.label} is thinking`;
  return `${playerLabel(current, current.currentPlayerId)} is moving`;
}

function renderPlayers(current) {
  if (!isElement(playersElement)) return;
  playersElement.replaceChildren();

  for (const player of current.state.players ?? []) {
    const participant = participantFor(current, player.id);
    const row = document.createElement("div");
    row.className = `player${current.currentPlayerId === player.id ? " current" : ""}`;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = playerLabel(current, player.id);
    if (participant?.model) name.title = participant.model;

    const role = document.createElement("span");
    role.className = "role";
    role.textContent = participant?.kind ? `${player.role} · ${participant.kind}` : player.role;

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${player.remaining} cards`;

    row.append(name, role, count);
    playersElement.append(row);
  }
}

function renderLastMove(current) {
  if (!isElement(lastMoveElement)) return;
  const last = current.state.lastPlay;
  if (!last) {
    lastMoveElement.textContent = "none · lead any legal pattern";
    return;
  }

  const cards = (last.cards ?? []).map((card) => rankLabel(card.rank)).join(" ");
  lastMoveElement.textContent = `${playerLabel(current, last.playerId)}  ${last.pattern?.kind ?? "play"}  ${cards}`;
}

function isHumanTurn(current = snapshot) {
  return Boolean(current && current.status === "playing" && current.currentPlayerId === VIEWER_ID);
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
  for (const id of selectedCardIds) {
    if (!currentIds.has(id)) selectedCardIds.delete(id);
  }

  if (!isHumanTurn(current) && selectedCardIds.size > 0) {
    selectedCardIds.clear();
    hintCursor = 0;
    selectedHintLabel = "";
  }
}

function renderHand(current) {
  if (!isElement(handElement)) return;
  handElement.replaceChildren();
  const selectable = isHumanTurn(current);

  for (const card of current.state.myHand ?? []) {
    const token = document.createElement("button");
    token.type = "button";
    token.className = `card-token${selectedCardIds.has(card.id) ? " selected" : ""}`;
    token.textContent = rankLabel(card.rank);
    token.title = selectable ? `click to ${selectedCardIds.has(card.id) ? "deselect" : "select"}` : "waiting for your turn";
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

  const turn = isHumanTurn(current);
  const cards = selectedCards(current);
  const canPass = current.controls?.canPass === true;
  const canHint = current.controls?.canHint === true;

  setActionDisabled(playSelectedButton, !turn || cards.length === 0);
  setActionDisabled(passMoveButton, !turn || !canPass);
  setActionDisabled(hintMoveButton, !turn || !canHint);
  setActionDisabled(clearSelectionButton, cards.length === 0);

  if (!turn) {
    selectionSummary.textContent = current.status === "paused" ? "paused" : "no input required";
    return;
  }

  if (cards.length === 0) {
    selectionSummary.textContent = "select cards from hand";
    return;
  }

  const labels = cards.map((card) => rankLabel(card.rank)).join(" ");
  selectionSummary.textContent = selectedHintLabel
    ? `${labels} · hint: ${selectedHintLabel}`
    : `${labels} · ${cards.length} selected`;
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

async function refreshRoom({ quiet = false } = {}) {
  if (!roomId) return false;
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) {
      throw new Error(body?.error?.message ?? "room unavailable");
    }
    render(body.snapshot);
    if (!quiet) setConnection("live");
    return true;
  } catch (error) {
    if (!quiet) {
      setConnection("room unavailable");
      if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "room unavailable";
    }
    return false;
  }
}

function scheduleRoomRefresh(current) {
  window.clearTimeout(roomRefreshTimer);
  roomRefreshTimer = null;
  if (!roomId || !current || current.status !== "playing") return;

  const participant = participantFor(current, current.currentPlayerId);
  if (participant?.kind !== "connected-agent") return;

  roomRefreshTimer = window.setTimeout(async () => {
    const beforeRevision = snapshot?.revision;
    const ok = await refreshRoom({ quiet: true });
    if (!ok) {
      roomRefreshTimer = window.setTimeout(() => scheduleRoomRefresh(snapshot), 1500);
      return;
    }
    if (snapshot?.revision === beforeRevision) scheduleRoomRefresh(snapshot);
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
      body: JSON.stringify({
        version: 1,
        expectedRevision,
        cardIds: cards.map((card) => card.id),
      }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !isGameSnapshot(body?.snapshot)) {
      throw new Error(body?.error?.message ?? "play rejected");
    }
    render(body.snapshot);
    setConnection("live");
  } catch (error) {
    setConnection("play rejected");
    if (isElement(selectionSummary)) {
      selectionSummary.classList.add("invalid");
      selectionSummary.textContent = error instanceof Error ? error.message : "selected cards are not legal";
    }
    if (isElement(gamePrompt)) gamePrompt.textContent = "adjust your selection";
    if (snapshot?.revision !== expectedRevision) void refreshRoom();
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
    if (!response.ok || !isGameSnapshot(body?.snapshot)) {
      throw new Error(body?.error?.message ?? "pass rejected");
    }
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
    if (!response.ok || !body?.hint || !Array.isArray(body.hint.cardIds)) {
      throw new Error(body?.error?.message ?? "hint unavailable");
    }

    selectedCardIds = new Set(body.hint.cardIds);
    selectionRevision = expectedRevision;
    hintCursor = Number.isSafeInteger(body.hint.index) ? body.hint.index + 1 : hintCursor + 1;
    selectedHintLabel = typeof body.hint.label === "string" ? body.hint.label : "suggested play";
    renderHand(snapshot);
    renderActions(snapshot);
    if (isElement(gamePrompt)) {
      const position = Number.isSafeInteger(body.hint.index) && Number.isSafeInteger(body.hint.total)
        ? `hint ${body.hint.index + 1}/${body.hint.total}`
        : "hint";
      gamePrompt.textContent = `${position} · ${selectedHintLabel}`;
    }
  } catch (error) {
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "hint unavailable";
    void refreshRoom({ quiet: true });
  }
}

function render(current) {
  snapshot = current;
  roomId = current.roomId;
  updateUrl();
  syncSelection(current);

  if (isElement(roomLabel)) roomLabel.textContent = `room / ${roomId.slice(0, 18)}`;
  if (isElement(gameStart)) gameStart.hidden = true;
  if (isElement(gameView)) gameView.hidden = false;
  if (isElement(roleValue)) roleValue.textContent = current.state.role ?? "-";
  if (isElement(turnValue)) turnValue.textContent = playerLabel(current, current.currentPlayerId);
  if (isElement(revisionValue)) revisionValue.textContent = String(current.revision);
  if (isElement(gameStatusValue)) gameStatusValue.textContent = current.status;
  if (isElement(gamePrompt)) gamePrompt.textContent = promptFor(current);

  renderPlayers(current);
  renderLastMove(current);
  renderHand(current);
  renderActions(current);
  scheduleRoomRefresh(current);
}

function showMcpSetup(createdRoomId, seatToken) {
  if (!isElement(mcpSetup) || !isElement(mcpConfig)) return;

  const endpoint = `${window.location.origin}/mcp`;
  const config = {
    mcpServers: {
      waitloop: {
        type: "http",
        url: endpoint,
        headers: {
          Authorization: `Bearer ${seatToken}`,
          "X-Waitloop-Room": createdRoomId,
        },
      },
    },
  };

  mcpConfigText = JSON.stringify(config, null, 2);
  mcpConfig.textContent = mcpConfigText;
  mcpSetup.hidden = false;
}

async function loadRoom() {
  if (!roomId) return false;
  const ok = await refreshRoom();
  if (!ok) {
    setCreateError("This browser does not have access to that room, or the room no longer exists.");
  }
  return ok;
}

async function createRoom(mode, hostedAgentId) {
  if (createInFlight) return;
  setCreateButtonsDisabled(true);
  setCreateError("");
  setConnection("creating room");
  if (isElement(mcpSetup)) mcpSetup.hidden = true;
  mcpConfigText = "";
  selectedCardIds.clear();
  selectionRevision = -1;
  hintCursor = 0;
  selectedHintLabel = "";

  const payload = {
    version: 1,
    gameId: "doudizhu",
    mode,
  };
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
    render(body.snapshot);
    if (mode === "connected-agent" && typeof body.agentSeatToken === "string") {
      showMcpSetup(body.roomId, body.agentSeatToken);
    }
    setConnection("live");
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
    } else {
      attention.hidden = true;
    }
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
      if (message?.version === 1 && message?.type === "agent.snapshot" && message.snapshot) {
        handleAgentSnapshot(message.snapshot);
      }
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

  for (const agent of hostedAgents) {
    if (!agent || typeof agent.id !== "string" || typeof agent.label !== "string") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-button";
    button.title = typeof agent.model === "string" ? agent.model : agent.label;

    const prompt = document.createElement("span");
    prompt.textContent = ">";
    button.append(prompt, document.createTextNode(` you + ${agent.label} + bot`));
    button.addEventListener("click", () => void createRoom("hosted-agent", agent.id));
    hostedAgentActions.append(button);
  }

  hostedAgentStatus.textContent = "Hosted by Waitloop. Only that seat's visible game state is sent to the model provider.";
}

newBotGameButton?.addEventListener("click", () => void createRoom("bots"));
newConnectedAgentGameButton?.addEventListener("click", () => void createRoom("connected-agent"));
playSelectedButton?.addEventListener("click", () => void playSelection());
passMoveButton?.addEventListener("click", () => void passTurn());
hintMoveButton?.addEventListener("click", () => void requestHint());
clearSelectionButton?.addEventListener("click", clearSelection);
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
  if (!snapshot || !isHumanTurn(snapshot)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "Enter" && selectedCardIds.size > 0) {
    event.preventDefault();
    void playSelection();
    return;
  }

  if (event.key.toLowerCase() === "h" && snapshot.controls?.canHint === true) {
    event.preventDefault();
    void requestHint();
    return;
  }

  if (event.key.toLowerCase() === "p" && snapshot.controls?.canPass === true) {
    event.preventDefault();
    void passTurn();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    clearSelection();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && roomId) void refreshRoom({ quiet: true });
});

if (roomId) void loadRoom();
void loadHostedAgents();
connectAgentSession();
