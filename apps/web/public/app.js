const runtimeStatus = document.querySelector("#runtime-status");
const sessionLabel = document.querySelector("#session-label");
const agentValue = document.querySelector("#agent-value");
const stateValue = document.querySelector("#state-value");
const elapsedValue = document.querySelector("#elapsed-value");
const promptValue = document.querySelector("#prompt-value");

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session");
let currentSnapshot = null;
let reconnectTimer = null;
let sessionSocket = null;
let sessionReconnectDelayMs = 1500;
let sessionSocketShuttingDown = false;
const MAX_SESSION_RECONNECT_DELAY_MS = 30000;

const stateClasses = [
  "state-idle",
  "state-running",
  "state-waiting",
  "state-completed",
  "state-failed",
];

function isElement(value) {
  return value instanceof HTMLElement;
}

function isSnapshot(value) {
  if (typeof value !== "object" || value === null) return false;

  return (
    value.version === 1 &&
    typeof value.sessionId === "string" &&
    typeof value.agent === "string" &&
    typeof value.state === "string" &&
    typeof value.startedAt === "number" &&
    typeof value.updatedAt === "number" &&
    typeof value.revision === "number"
  );
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function elapsedFor(snapshot) {
  const terminalAt =
    (snapshot.state === "completed" || snapshot.state === "failed") &&
    typeof snapshot.finishedAt === "number"
      ? snapshot.finishedAt
      : Date.now();

  return formatDuration(terminalAt - snapshot.startedAt);
}

function promptForState(state) {
  switch (state) {
    case "running":
      return "agent working · waiting layer ready";
    case "waiting":
      return "agent needs attention · return to work";
    case "completed":
      return "agent completed · return to work";
    case "failed":
      return "agent failed · return to work";
    case "idle":
    default:
      return "agent idle";
  }
}

function renderSnapshot(snapshot) {
  currentSnapshot = snapshot;

  if (isElement(sessionLabel)) {
    sessionLabel.textContent = `session / ${snapshot.sessionId.slice(0, 16)}`;
  }

  if (isElement(agentValue)) {
    agentValue.textContent = snapshot.agent;
  }

  if (isElement(stateValue)) {
    stateValue.textContent = snapshot.state;
    stateValue.classList.remove(...stateClasses);
    stateValue.classList.add(`state-${snapshot.state}`);
  }

  if (isElement(elapsedValue)) {
    elapsedValue.textContent = elapsedFor(snapshot);
  }

  if (isElement(promptValue)) {
    promptValue.textContent = promptForState(snapshot.state);
  }
}

async function checkRuntime() {
  if (!isElement(runtimeStatus)) return;

  try {
    const response = await fetch("/api/v1/health", {
      headers: { accept: "application/json" },
    });

    if (!response.ok) throw new Error("health check failed");

    runtimeStatus.textContent = "runtime online";
    runtimeStatus.classList.add("online");
    runtimeStatus.classList.remove("offline");
  } catch {
    runtimeStatus.textContent = "runtime offline";
    runtimeStatus.classList.add("offline");
    runtimeStatus.classList.remove("online");
  }
}

async function loadSnapshot(id) {
  const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    if (isElement(promptValue)) {
      promptValue.textContent = response.status === 404 ? "session not found" : "could not load session";
    }
    return false;
  }

  const body = await response.json();
  if (!isSnapshot(body?.snapshot)) {
    if (isElement(promptValue)) promptValue.textContent = "invalid session response";
    return false;
  }

  renderSnapshot(body.snapshot);
  return true;
}

function clearSessionReconnect() {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleSessionReconnect(id) {
  clearSessionReconnect();
  if (sessionSocketShuttingDown || document.hidden) return;
  const delayMs = sessionReconnectDelayMs;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    sessionReconnectDelayMs = Math.min(MAX_SESSION_RECONNECT_DELAY_MS, sessionReconnectDelayMs * 2);
    connectSessionSocket(id);
  }, delayMs);
}

function connectSessionSocket(id) {
  if (sessionSocketShuttingDown || document.hidden) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/v1/sessions/${encodeURIComponent(id)}/ws`;
  const socket = new WebSocket(url);
  sessionSocket = socket;

  socket.addEventListener("open", () => {
    sessionReconnectDelayMs = 1500;
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;

    try {
      const message = JSON.parse(event.data);
      if (message?.version === 1 && message?.type === "agent.snapshot" && isSnapshot(message.snapshot)) {
        renderSnapshot(message.snapshot);
      }
    } catch {
      // Ignore malformed server messages; the next valid snapshot will repair the view.
    }
  });

  socket.addEventListener("close", () => {
    if (sessionSocket === socket) sessionSocket = null;
    scheduleSessionReconnect(id);
  });
}

async function start() {
  await checkRuntime();

  if (!sessionId) {
    if (isElement(promptValue)) {
      promptValue.textContent = "open ?session=<id> to follow an agent";
    }
    return;
  }

  const loaded = await loadSnapshot(sessionId);
  if (loaded) connectSessionSocket(sessionId);
}

document.addEventListener("visibilitychange", () => {
  if (!sessionId) return;
  if (document.hidden) {
    clearSessionReconnect();
    return;
  }
  if (!sessionSocket || sessionSocket.readyState === WebSocket.CLOSED) {
    sessionReconnectDelayMs = 1500;
    connectSessionSocket(sessionId);
  }
});

window.addEventListener("pagehide", () => {
  sessionSocketShuttingDown = true;
  clearSessionReconnect();
  sessionSocket?.close(1000, "page hidden");
});

window.setInterval(() => {
  if (currentSnapshot && isElement(elapsedValue)) {
    elapsedValue.textContent = elapsedFor(currentSnapshot);
  }
}, 1000);

void start();
