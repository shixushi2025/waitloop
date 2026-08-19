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
let roomSocket = null;
let roomReconnectTimer = null;
let sessionSocket = null;
let attentionPauseRequested = false;
let mcpConfigText = "";
let hostedAgents = [];
let createInFlight = false;
let selectionRevision = -1;
let selectedCardIds = new Set();
let hintCursor = 0;

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
    Array.isArray(value.legalMoves)
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

function playCardsFor(move) {
  if (move?.meta?.type !== "play" || !Array.isArray(move.meta.cards)) return null;
  return move.meta.cards.every((card) => card && typeof card.id === "string") ? move.meta.cards : null;
}

function cardSignature(cards) {
  return cards.map((card) => card.id).sort().join("\u001f");
}

function selectedCards(current = snapshot) {
  if (!current || !Array.isArray(current.state?.myHand)) return [];
  return current.state.myHand.filter((card) => selectedCardIds.has(card.id));
}

function playableMoves(current = snapshot) {
  if (!current || !Array.isArray(current.legalMoves)) return [];
  return current.legalMoves.filter((move) => playCardsFor(move) !== null);
}

function findSelectedMove(current = snapshot) {
  const cards = selectedCards(current);
  if (cards.length === 0) return null;
  const signature = cardSignature(cards);
  return playableMoves(current).find((move) => cardSignature(playCardsFor(move)) === signature) ?? null;
}

function syncSelection(current) {
  if (selectionRevision !== current.revision) {
    selectedCardIds = new Set();
    selectionRevision = current.revision;
    hintCursor = 0;
  }

  const currentIds = new Set((current.state.myHand ?? []).map((card) => card.id));
  for (const id of selectedCardIds) {
    if (!currentIds.has(id)) selectedCardIds.delete(id);
  }

  if (!isHumanTurn(current) && selectedCardIds.size > 0) {
    selectedCardIds.clear();
    hintCursor = 0;
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
    token.title = selectable ? `${card.id} · click to ${selectedCardIds.has(card.id) ? "deselect" : "select"}` : card.id;
    token.disabled = !selectable;
    token.setAttribute("aria-pressed", selectedCardIds.has(card.id) ? "true" : "false");
    token.addEventListener("click", () => {
      if (!snapshot || !isHumanTurn(snapshot)) return;
      if (selectedCardIds.has(card.id)) selectedCardIds.delete(card.id);
      else selectedCardIds.add(card.id);
      hintCursor = 0;
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
  const selectedMove = cards.length > 0 ? findSelectedMove(current) : null;
  const passMove = current.legalMoves.find((move) => move.id === "pass") ?? null;
  const hints = playableMoves(current);

  setActionDisabled(playSelectedButton, !turn || !selectedMove);
  setActionDisabled(passMoveButton, !turn || !passMove);
  setActionDisabled(hintMoveButton, !turn || hints.length === 0);
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
  if (selectedMove) {
    selectionSummary.classList.add("valid");
    selectionSummary.textContent = `${labels} · ${selectedMove.label}`;
    return;
  }

  selectionSummary.classList.add("invalid");
  selectionSummary.textContent = `${labels} · not a legal play`;
}

function clearSelection() {
  selectedCardIds.clear();
  hintCursor = 0;
  if (snapshot) {
    renderHand(snapshot);
    renderActions(snapshot);
  }
}

function hintMoves(current = snapshot) {
  return playableMoves(current).slice().sort((a, b) => {
    const kindA = a?.meta?.pattern?.kind;
    const kindB = b?.meta?.pattern?.kind;
    const penaltyA = kindA === "rocket" ? 2 : kindA === "bomb" ? 1 : 0;
    const penaltyB = kindB === "rocket" ? 2 : kindB === "bomb" ? 1 : 0;
    return penaltyA - penaltyB;
  });
}

function selectHint() {
  if (!snapshot || !isHumanTurn(snapshot)) return;
  const moves = hintMoves(snapshot);
  if (moves.length === 0) return;

  const index = hintCursor % moves.length;
  const move = moves[index];
  const cards = playCardsFor(move);
  if (!cards) return;

  selectedCardIds = new Set(cards.map((card) => card.id));
  selectionRevision = snapshot.revision;
  hintCursor = (index + 1) % moves.length;
  renderHand(snapshot);
  renderActions(snapshot);
  if (isElement(gamePrompt)) gamePrompt.textContent = `hint ${index + 1}/${moves.length} · ${move.label}`;
}

async function playMove(moveId) {
  if (!roomId || !snapshot || snapshot.status !== "playing") return;

  try {
    setConnection("opponents moving");
    if (isElement(gamePrompt)) gamePrompt.textContent = "move sent · resolving table";
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/moves`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        version: 1,
        expectedRevision: snapshot.revision,
        moveId,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? "move rejected");
    if (isGameSnapshot(body.snapshot)) render(body.snapshot);
    setConnection("live");
  } catch (error) {
    setConnection("move failed");
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "move failed";
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

  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok || !isGameSnapshot(body.snapshot)) throw new Error(body?.error?.message ?? "room unavailable");
    render(body.snapshot);
    connectRoomSocket();
    return true;
  } catch (error) {
    setConnection("room unavailable");
    setCreateError("This browser does not have access to that room, or the room no longer exists.");
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "room unavailable";
    return false;
  }
}

function connectRoomSocket() {
  if (!roomId) return;
  if (roomSocket) roomSocket.close();

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  roomSocket = new WebSocket(`${protocol}//${window.location.host}/api/v1/rooms/${encodeURIComponent(roomId)}/ws`);

  roomSocket.addEventListener("open", () => setConnection("live"));
  roomSocket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data);
      if (message?.version === 1 && message?.type === "game.snapshot" && isGameSnapshot(message.snapshot)) {
        render(message.snapshot);
      }
    } catch {
      // The next authoritative snapshot repairs the view.
    }
  });
  roomSocket.addEventListener("close", () => {
    if (!roomId) return;
    setConnection("reconnecting");
    window.clearTimeout(roomReconnectTimer);
    roomReconnectTimer = window.setTimeout(connectRoomSocket, 1500);
  });
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
    const body = await response.json();
    if (!response.ok || !isGameSnapshot(body.snapshot)) throw new Error(body?.error?.message ?? "could not create room");

    roomId = body.roomId;
    render(body.snapshot);
    if (mode === "connected-agent" && typeof body.agentSeatToken === "string") {
      showMcpSetup(body.roomId, body.agentSeatToken);
    }
    connectRoomSocket();
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
    const body = await response.json();
    if (response.ok && isGameSnapshot(body.snapshot)) render(body.snapshot);
  } catch {
    // Attention notification remains visible even if game pause delivery fails.
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
    const body = await response.json();
    hostedAgents = response.ok && Array.isArray(body.agents) ? body.agents : [];
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
playSelectedButton?.addEventListener("click", () => {
  const move = findSelectedMove();
  if (move) void playMove(move.id);
});
passMoveButton?.addEventListener("click", () => {
  if (snapshot?.legalMoves?.some((move) => move.id === "pass")) void playMove("pass");
});
hintMoveButton?.addEventListener("click", selectHint);
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

  if (event.key === "Enter") {
    const move = findSelectedMove(snapshot);
    if (move) {
      event.preventDefault();
      void playMove(move.id);
    }
    return;
  }

  if (event.key.toLowerCase() === "h") {
    event.preventDefault();
    selectHint();
    return;
  }

  if (event.key.toLowerCase() === "p" && snapshot.legalMoves.some((move) => move.id === "pass")) {
    event.preventDefault();
    void playMove("pass");
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    clearSelection();
  }
});

if (roomId) void loadRoom();
void loadHostedAgents();
connectAgentSession();
