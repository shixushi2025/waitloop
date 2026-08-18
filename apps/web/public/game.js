const VIEWER_ID = "you";
const params = new URLSearchParams(window.location.search);
const linkedSessionId = params.get("session");

const roomLabel = document.querySelector("#room-label");
const connectionStatus = document.querySelector("#connection-status");
const gameStart = document.querySelector("#game-start");
const gameView = document.querySelector("#game-view");
const newBotGameButton = document.querySelector("#new-bot-game");
const newAgentGameButton = document.querySelector("#new-agent-game");
const roleValue = document.querySelector("#role-value");
const turnValue = document.querySelector("#turn-value");
const revisionValue = document.querySelector("#revision-value");
const gameStatusValue = document.querySelector("#game-status-value");
const playersElement = document.querySelector("#players");
const lastMoveElement = document.querySelector("#last-move");
const handElement = document.querySelector("#hand");
const movesElement = document.querySelector("#moves");
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

function updateUrl() {
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set("room", roomId);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

function setConnection(text) {
  if (isElement(connectionStatus)) connectionStatus.textContent = text;
}

function setCreateButtonsDisabled(disabled) {
  if (newBotGameButton instanceof HTMLButtonElement) newBotGameButton.disabled = disabled;
  if (newAgentGameButton instanceof HTMLButtonElement) newAgentGameButton.disabled = disabled;
}

function promptFor(current) {
  if (current.status === "finished") {
    return current.state.winnerId === VIEWER_ID ? "you won · return to work when ready" : `${current.state.winnerId} won`;
  }
  if (current.status === "paused") return "game paused · work has priority";
  if (current.currentPlayerId === VIEWER_ID) return "your turn · choose a legal move";
  if (current.currentPlayerId === "agent") return "agent turn · waiting for MCP move";
  return `${current.currentPlayerId ?? "room"} is moving`;
}

function renderPlayers(current) {
  if (!isElement(playersElement)) return;
  playersElement.replaceChildren();

  for (const player of current.state.players ?? []) {
    const row = document.createElement("div");
    row.className = `player${current.currentPlayerId === player.id ? " current" : ""}`;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = player.id === VIEWER_ID ? "you" : player.id;

    const role = document.createElement("span");
    role.className = "role";
    role.textContent = player.role;

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
  lastMoveElement.textContent = `${last.playerId}  ${last.pattern?.kind ?? "play"}  ${cards}`;
}

function renderHand(current) {
  if (!isElement(handElement)) return;
  handElement.replaceChildren();

  for (const card of current.state.myHand ?? []) {
    const token = document.createElement("span");
    token.className = "card-token";
    token.textContent = rankLabel(card.rank);
    token.title = card.id;
    handElement.append(token);
  }
}

async function playMove(moveId) {
  if (!roomId || !snapshot || snapshot.status !== "playing") return;

  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/moves`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        version: 1,
        playerId: VIEWER_ID,
        expectedRevision: snapshot.revision,
        moveId,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? "move rejected");
    if (isGameSnapshot(body.snapshot)) render(body.snapshot);
  } catch (error) {
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "move failed";
  }
}

function renderMoves(current) {
  if (!isElement(movesElement)) return;
  movesElement.replaceChildren();

  if (current.status !== "playing" || current.currentPlayerId !== VIEWER_ID) {
    const empty = document.createElement("span");
    empty.className = "last-move";
    empty.textContent = current.status === "paused" ? "paused" : "no input required";
    movesElement.append(empty);
    return;
  }

  current.legalMoves.forEach((move, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `move-button${move.id === "pass" ? " pass" : ""}`;

    const number = document.createElement("span");
    number.className = "move-index";
    number.textContent = String(index + 1).padStart(2, "0");

    const label = document.createElement("span");
    label.textContent = move.label;

    button.append(number, label);
    button.addEventListener("click", () => void playMove(move.id));
    movesElement.append(button);
  });
}

function render(current) {
  snapshot = current;
  roomId = current.roomId;
  updateUrl();

  if (isElement(roomLabel)) roomLabel.textContent = `room / ${roomId.slice(0, 18)}`;
  if (isElement(gameStart)) gameStart.hidden = true;
  if (isElement(gameView)) gameView.hidden = false;
  if (isElement(roleValue)) roleValue.textContent = current.state.role ?? "-";
  if (isElement(turnValue)) turnValue.textContent = current.currentPlayerId ?? "none";
  if (isElement(revisionValue)) revisionValue.textContent = String(current.revision);
  if (isElement(gameStatusValue)) gameStatusValue.textContent = current.status;
  if (isElement(gamePrompt)) gamePrompt.textContent = promptFor(current);

  renderPlayers(current);
  renderLastMove(current);
  renderHand(current);
  renderMoves(current);
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
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}?viewer=${encodeURIComponent(VIEWER_ID)}`, {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok || !isGameSnapshot(body.snapshot)) throw new Error(body?.error?.message ?? "room unavailable");
    render(body.snapshot);
    connectRoomSocket();
    return true;
  } catch (error) {
    setConnection("room unavailable");
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "room unavailable";
    return false;
  }
}

function connectRoomSocket() {
  if (!roomId) return;
  if (roomSocket) roomSocket.close();

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  roomSocket = new WebSocket(`${protocol}//${window.location.host}/api/v1/rooms/${encodeURIComponent(roomId)}/ws?viewer=${encodeURIComponent(VIEWER_ID)}`);

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
    setConnection("reconnecting");
    window.clearTimeout(roomReconnectTimer);
    roomReconnectTimer = window.setTimeout(connectRoomSocket, 1500);
  });
}

async function createRoom(mode) {
  setCreateButtonsDisabled(true);
  setConnection("creating room");
  if (isElement(mcpSetup)) mcpSetup.hidden = true;
  mcpConfigText = "";

  const agentMode = mode === "agent";
  const payload = agentMode
    ? {
        version: 1,
        gameId: "doudizhu",
        playerIds: [VIEWER_ID, "agent", "bot"],
        landlordId: VIEWER_ID,
        viewerId: VIEWER_ID,
        botPlayerIds: ["bot"],
        agentPlayerId: "agent",
      }
    : {
        version: 1,
        gameId: "doudizhu",
        playerIds: [VIEWER_ID, "bot-a", "bot-b"],
        landlordId: VIEWER_ID,
        viewerId: VIEWER_ID,
        botPlayerIds: ["bot-a", "bot-b"],
      };

  try {
    const response = await fetch("/api/v1/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || !isGameSnapshot(body.snapshot)) throw new Error(body?.error?.message ?? "could not create room");

    roomId = body.roomId;
    render(body.snapshot);
    if (agentMode && typeof body.agentSeatToken === "string") {
      showMcpSetup(body.roomId, body.agentSeatToken);
    }
    connectRoomSocket();
  } catch (error) {
    setConnection("create failed");
    if (isElement(gamePrompt)) gamePrompt.textContent = error instanceof Error ? error.message : "create failed";
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
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1, viewerId: VIEWER_ID }),
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

newBotGameButton?.addEventListener("click", () => void createRoom("bots"));
newAgentGameButton?.addEventListener("click", () => void createRoom("agent"));
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
  if (!snapshot || snapshot.currentPlayerId !== VIEWER_ID || snapshot.status !== "playing") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const index = Number(event.key) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= 9) return;
  const move = snapshot.legalMoves[index];
  if (move) void playMove(move.id);
});

if (roomId) void loadRoom();
connectAgentSession();
