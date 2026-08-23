import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

function patchMcpApp() {
  const path = "packages/cli/src/mcp-app.ts";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    `        actionBusy: false,\n        pollBusy: false,\n        pollTimer: null,\n`,
    `        actionBusy: false,\n        refreshBusy: false,\n`,
    "MCP App state",
  );
  source = replaceOnce(source, `\n          stopPolling();`, ``, "MCP App finished polling stop");
  source = replaceOnce(source, `\n        schedulePolling();`, ``, "MCP App render polling schedule");
  source = replaceOnce(
    source,
    `      async function refresh(quiet) {\n        if (!state.payload || state.pollBusy) return;\n        state.pollBusy = true;\n        try { await callTool("ui_get_game", { roomId: state.payload.roomId }, Boolean(quiet)); }\n        catch (error) { if (!quiet) setMessage(error instanceof Error ? error.message : String(error), "error"); }\n        finally { state.pollBusy = false; }\n      }\n`,
    `      async function refresh(quiet) {\n        if (!state.payload || state.refreshBusy) return;\n        state.refreshBusy = true;\n        try { await callTool("ui_get_game", { roomId: state.payload.roomId }, Boolean(quiet)); }\n        catch (error) { if (!quiet) setMessage(error instanceof Error ? error.message : String(error), "error"); }\n        finally { state.refreshBusy = false; }\n      }\n\n      function refreshWhenVisible() {\n        if (document.visibilityState !== "visible" || !state.payload || !canUseTools() || state.actionBusy) return;\n        void refresh(true);\n      }\n`,
    "MCP App refresh",
  );
  source = replaceOnce(
    source,
    `      function stopPolling() {\n        if (state.pollTimer !== null) window.clearTimeout(state.pollTimer);\n        state.pollTimer = null;\n      }\n\n      function schedulePolling() {\n        stopPolling();\n        if (!state.payload || state.payload.snapshot.status === "finished" || !canUseTools()) return;\n        state.pollTimer = window.setTimeout(async function () {\n          await refresh(true);\n          schedulePolling();\n        }, 1200);\n      }\n\n`,
    ``,
    "MCP App polling functions",
  );
  source = replaceOnce(
    source,
    `        if (incoming.method === "ui/resource-teardown" && Object.prototype.hasOwnProperty.call(incoming, "id")) {\n          stopPolling();\n          send({ jsonrpc: "2.0", id: incoming.id, result: {} });\n        }\n`,
    `        if (incoming.method === "ui/resource-teardown" && Object.prototype.hasOwnProperty.call(incoming, "id")) {\n          state.connected = false;\n          send({ jsonrpc: "2.0", id: incoming.id, result: {} });\n        }\n`,
    "MCP App teardown",
  );
  source = replaceOnce(
    source,
    `      if (typeof ResizeObserver === "function") {\n`,
    `      document.addEventListener("visibilitychange", function () {\n        if (document.visibilityState === "visible") refreshWhenVisible();\n      });\n      window.addEventListener("focus", refreshWhenVisible);\n\n      if (typeof ResizeObserver === "function") {\n`,
    "MCP App visibility refresh",
  );

  writeFileSync(path, source);
}

function patchStandaloneGame() {
  const path = "apps/web/public/game.js";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    `import { historyDelta, recentHistory } from "./game-history.js";\n`,
    `import { historyDelta, recentHistory } from "./game-history.js";\nimport {\n  nextRoomRefreshDelay,\n  ROOM_REFRESH_MIN_DELAY_MS,\n  roomRefreshSignature,\n  shouldRefreshRoom,\n} from "./room-refresh-policy.js";\n`,
    "game refresh policy import",
  );
  source = replaceOnce(
    source,
    `let roomRefreshTimer = null;\nlet turnClockTimer = null;\n`,
    `let roomRefreshTimer = null;\nlet roomRefreshDelayMs = ROOM_REFRESH_MIN_DELAY_MS;\nlet turnClockTimer = null;\n`,
    "game refresh state",
  );
  source = replaceOnce(
    source,
    `function render(current) {\n  const previous = snapshot;\n`,
    `function render(current) {\n  const previous = snapshot;\n  if (!previous || roomRefreshSignature(previous) !== roomRefreshSignature(current)) {\n    roomRefreshDelayMs = ROOM_REFRESH_MIN_DELAY_MS;\n  }\n`,
    "game render refresh reset",
  );
  source = replaceOnce(
    source,
    `function scheduleRoomRefresh(current) {\n  window.clearTimeout(roomRefreshTimer);\n  roomRefreshTimer = null;\n  if (!roomId || !current || current.status === "finished") return;\n  const needsPolling = phaseOf(current) === "waiting_for_players" || connectedActors(current).length > 0;\n  if (!needsPolling) return;\n  roomRefreshTimer = window.setTimeout(async () => {\n    const ok = await refreshRoom({ quiet: true });\n    if (!ok && snapshot) scheduleRoomRefresh(snapshot);\n  }, 1000);\n}\n`,
    `function stopRoomRefresh() {\n  window.clearTimeout(roomRefreshTimer);\n  roomRefreshTimer = null;\n}\n\nfunction scheduleRoomRefresh(current) {\n  stopRoomRefresh();\n  if (!roomId || !shouldRefreshRoom(current, !document.hidden)) return;\n  const scheduledSignature = roomRefreshSignature(current);\n  const delayMs = roomRefreshDelayMs;\n  roomRefreshTimer = window.setTimeout(async () => {\n    const ok = await refreshRoom({ quiet: true });\n    if (!snapshot) return;\n    const changed = ok && roomRefreshSignature(snapshot) !== scheduledSignature;\n    roomRefreshDelayMs = nextRoomRefreshDelay(roomRefreshDelayMs, changed);\n    scheduleRoomRefresh(snapshot);\n  }, delayMs);\n}\n`,
    "game refresh scheduler",
  );
  source = replaceOnce(
    source,
    `document.addEventListener("visibilitychange", () => {\n  if (!document.hidden && roomId) void refreshRoom({ quiet: true });\n});\n\nif (roomId) void loadRoom();\n`,
    `document.addEventListener("visibilitychange", () => {\n  if (document.hidden) {\n    stopRoomRefresh();\n    return;\n  }\n  roomRefreshDelayMs = ROOM_REFRESH_MIN_DELAY_MS;\n  if (roomId) void refreshRoom({ quiet: true });\n});\n\nwindow.addEventListener("pagehide", () => {\n  stopRoomRefresh();\n  window.clearInterval(turnClockTimer);\n});\n\nif (roomId) void loadRoom();\n`,
    "game visibility lifecycle",
  );

  writeFileSync(path, source);
}

function patchLifecyclePage() {
  const path = "apps/web/public/app.js";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    `let currentSnapshot = null;\nlet reconnectTimer = null;\n`,
    `let currentSnapshot = null;\nlet reconnectTimer = null;\nlet sessionSocket = null;\nlet sessionReconnectDelayMs = 1500;\nlet sessionSocketShuttingDown = false;\nconst MAX_SESSION_RECONNECT_DELAY_MS = 30000;\n`,
    "lifecycle socket state",
  );
  source = replaceOnce(
    source,
    `function connectSessionSocket(id) {\n  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";\n  const url = \`${protocol}//${window.location.host}/api/v1/sessions/${encodeURIComponent(id)}/ws\`;\n  const socket = new WebSocket(url);\n\n  socket.addEventListener("message", (event) => {\n    if (typeof event.data !== "string") return;\n\n    try {\n      const message = JSON.parse(event.data);\n      if (message?.version === 1 && message?.type === "agent.snapshot" && isSnapshot(message.snapshot)) {\n        renderSnapshot(message.snapshot);\n      }\n    } catch {\n      // Ignore malformed server messages; the next valid snapshot will repair the view.\n    }\n  });\n\n  socket.addEventListener("close", () => {\n    window.clearTimeout(reconnectTimer);\n    reconnectTimer = window.setTimeout(() => connectSessionSocket(id), 1500);\n  });\n}\n`,
    `function clearSessionReconnect() {\n  window.clearTimeout(reconnectTimer);\n  reconnectTimer = null;\n}\n\nfunction scheduleSessionReconnect(id) {\n  clearSessionReconnect();\n  if (sessionSocketShuttingDown || document.hidden) return;\n  const delayMs = sessionReconnectDelayMs;\n  reconnectTimer = window.setTimeout(() => {\n    reconnectTimer = null;\n    sessionReconnectDelayMs = Math.min(MAX_SESSION_RECONNECT_DELAY_MS, sessionReconnectDelayMs * 2);\n    connectSessionSocket(id);\n  }, delayMs);\n}\n\nfunction connectSessionSocket(id) {\n  if (sessionSocketShuttingDown || document.hidden) return;\n  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";\n  const url = \`${protocol}//${window.location.host}/api/v1/sessions/${encodeURIComponent(id)}/ws\`;\n  const socket = new WebSocket(url);\n  sessionSocket = socket;\n\n  socket.addEventListener("open", () => {\n    sessionReconnectDelayMs = 1500;\n  });\n\n  socket.addEventListener("message", (event) => {\n    if (typeof event.data !== "string") return;\n\n    try {\n      const message = JSON.parse(event.data);\n      if (message?.version === 1 && message?.type === "agent.snapshot" && isSnapshot(message.snapshot)) {\n        renderSnapshot(message.snapshot);\n      }\n    } catch {\n      // Ignore malformed server messages; the next valid snapshot will repair the view.\n    }\n  });\n\n  socket.addEventListener("close", () => {\n    if (sessionSocket === socket) sessionSocket = null;\n    scheduleSessionReconnect(id);\n  });\n}\n`,
    "lifecycle socket reconnect",
  );
  source = replaceOnce(
    source,
    `window.setInterval(() => {\n`,
    `document.addEventListener("visibilitychange", () => {\n  if (!sessionId) return;\n  if (document.hidden) {\n    clearSessionReconnect();\n    return;\n  }\n  if (!sessionSocket || sessionSocket.readyState === WebSocket.CLOSED) {\n    sessionReconnectDelayMs = 1500;\n    connectSessionSocket(sessionId);\n  }\n});\n\nwindow.addEventListener("pagehide", () => {\n  sessionSocketShuttingDown = true;\n  clearSessionReconnect();\n  sessionSocket?.close(1000, "page hidden");\n});\n\nwindow.setInterval(() => {\n`,
    "lifecycle visibility handling",
  );

  writeFileSync(path, source);
}

patchMcpApp();
patchStandaloneGame();
patchLifecyclePage();
console.log("request polling patches applied");
