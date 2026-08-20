const code = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) ?? "").toUpperCase();
const codeLabel = document.querySelector("#join-code-label");
const stateValue = document.querySelector("#join-state");
const gameValue = document.querySelector("#join-game");
const roomValue = document.querySelector("#join-room");
const phaseValue = document.querySelector("#join-phase");
const relationValue = document.querySelector("#join-relation");
const seatValue = document.querySelector("#join-seat");
const actorValue = document.querySelector("#join-actor");
const joinExpiresValue = document.querySelector("#join-expires");
const roomExpiresValue = document.querySelector("#room-expires");
const commandValue = document.querySelector("#join-command");
const promptValue = document.querySelector("#join-prompt");
const copyCommandButton = document.querySelector("#copy-command");
const claimButton = document.querySelector("#claim-mcp");
const rawWrap = document.querySelector("#raw-config-wrap");
const rawConfig = document.querySelector("#raw-config");
const copyConfigButton = document.querySelector("#copy-config");

let rawConfigText = "";

function setText(element, value) {
  if (element instanceof HTMLElement) element.textContent = value;
}

function formatExpiry(value) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  try {
    return new Date(value).toISOString();
  } catch {
    return "-";
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function render(info) {
  setText(codeLabel, `join / ${info.code}`);
  setText(stateValue, info.claimed ? "credential claimed" : "available");
  setText(gameValue, info.gameId ?? "-");
  setText(roomValue, info.roomId ?? "-");
  setText(phaseValue, info.phase ?? "-");
  setText(relationValue, info.relation ?? "controller");
  setText(seatValue, info.seatId ?? info.playerId ?? "-");
  setText(actorValue, info.actorId ?? info.playerId ?? "-");
  setText(joinExpiresValue, formatExpiry(info.expiresAt));
  setText(roomExpiresValue, formatExpiry(info.roomExpiresAt));
  setText(commandValue, info.joinCommand ?? `waitloop join ${code}`);
  const relation = info.relation === "advisor" ? "advisor" : "controller";
  setText(
    promptValue,
    info.seatStatus === "connected"
      ? `${relation} connected · room credential can reconnect until room expiry`
      : `waiting for ${relation} connection`,
  );
  if (claimButton instanceof HTMLButtonElement) claimButton.disabled = info.claimed || info.seatStatus === "connected";
}

async function load() {
  try {
    const response = await fetch(`/api/v1/join/${encodeURIComponent(code)}`, { headers: { accept: "application/json" } });
    const body = await readJson(response);
    if (!response.ok || !body) throw new Error(body?.error?.message ?? "join code unavailable");
    render(body);
  } catch (error) {
    setText(stateValue, "unavailable");
    setText(promptValue, error instanceof Error ? error.message : "join code unavailable");
  }
}

async function claimRaw() {
  if (claimButton instanceof HTMLButtonElement) claimButton.disabled = true;
  try {
    const response = await fetch(`/api/v1/join/${encodeURIComponent(code)}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    const body = await readJson(response);
    if (!response.ok || !body?.mcp) throw new Error(body?.error?.message ?? "could not claim MCP actor");
    rawConfigText = JSON.stringify({ mcpServers: { waitloop: body.mcp } }, null, 2);
    setText(rawConfig, rawConfigText);
    if (rawWrap instanceof HTMLElement) rawWrap.hidden = false;
    render(body);
    setText(promptValue, `${body.relation ?? "controller"} credential claimed · connect or reconnect MCP while the room is active`);
  } catch (error) {
    setText(promptValue, error instanceof Error ? error.message : "MCP claim failed");
  } finally {
    if (claimButton instanceof HTMLButtonElement && !rawConfigText) claimButton.disabled = false;
  }
}

copyCommandButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`waitloop join ${code}`);
    setText(copyCommandButton, "copied");
  } catch {
    setText(copyCommandButton, "copy failed");
  }
});

copyConfigButton?.addEventListener("click", async () => {
  if (!rawConfigText) return;
  try {
    await navigator.clipboard.writeText(rawConfigText);
    setText(copyConfigButton, "copied");
  } catch {
    setText(copyConfigButton, "copy failed");
  }
});

claimButton?.addEventListener("click", () => void claimRaw());
void load();
