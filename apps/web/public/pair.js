const pairingLabel = document.querySelector("#pairing-label");
const pairingRuntime = document.querySelector("#pairing-runtime");
const pairingCode = document.querySelector("#pairing-code");
const deviceId = document.querySelector("#device-id");
const expiresValue = document.querySelector("#expires-value");
const pairingMessage = document.querySelector("#pairing-message");
const approveButton = document.querySelector("#approve-button");
const pairingPrompt = document.querySelector("#pairing-prompt");

const match = /^\/pair\/(pair_[A-Za-z0-9_-]{32,128})$/.exec(window.location.pathname);
const pairingId = match?.[1] ?? null;
let expiresAt = 0;
let countdownTimer = null;

function isElement(value) {
  return value instanceof HTMLElement;
}

function setRuntime(text, state) {
  if (!isElement(pairingRuntime)) return;
  pairingRuntime.textContent = text;
  pairingRuntime.classList.remove("online", "offline");
  if (state) pairingRuntime.classList.add(state);
}

function setMessage(text, className) {
  if (!isElement(pairingMessage)) return;
  pairingMessage.textContent = text;
  pairingMessage.classList.remove("pair-success", "pair-error");
  if (className) pairingMessage.classList.add(className);
}

function formatRemaining() {
  const remaining = Math.max(0, expiresAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function updateCountdown() {
  if (!isElement(expiresValue) || expiresAt === 0) return;
  expiresValue.textContent = formatRemaining();
  if (Date.now() >= expiresAt) {
    window.clearInterval(countdownTimer);
    if (approveButton instanceof HTMLButtonElement) approveButton.disabled = true;
    setRuntime("expired", "offline");
    setMessage("This pairing request expired. Run `waitloop pair` again.", "pair-error");
    if (isElement(pairingPrompt)) pairingPrompt.textContent = "request expired";
  }
}

async function errorMessage(response) {
  try {
    const body = await response.json();
    if (body?.error?.message) return body.error.message;
  } catch {
    // Use status fallback.
  }
  return `HTTP ${response.status}`;
}

function shortDevice(value) {
  if (typeof value !== "string") return "unknown";
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

async function loadPairing() {
  if (!pairingId) {
    setRuntime("invalid", "offline");
    setMessage("Invalid pairing URL.", "pair-error");
    return;
  }

  try {
    const response = await fetch(`/api/v1/pairings/${encodeURIComponent(pairingId)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = await response.json();

    expiresAt = body.expiresAt;
    if (isElement(pairingLabel)) pairingLabel.textContent = `pairing / ${pairingId.slice(0, 18)}`;
    if (isElement(pairingCode)) pairingCode.textContent = body.code ?? "-";
    if (isElement(deviceId)) deviceId.textContent = shortDevice(body.deviceId);

    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1000);

    if (body.exchanged) {
      setRuntime("paired", "online");
      setMessage("This request was already exchanged for a device credential.", "pair-success");
      if (isElement(pairingPrompt)) pairingPrompt.textContent = "pairing complete · return to terminal";
      return;
    }

    if (body.approved) {
      setRuntime("approved", "online");
      setMessage("Approved. The CLI can now finish pairing.", "pair-success");
      if (isElement(pairingPrompt)) pairingPrompt.textContent = "approved · return to terminal";
      return;
    }

    setRuntime("ready", "online");
    setMessage("Approve only if you just ran `waitloop pair` on the device shown above.");
    if (approveButton instanceof HTMLButtonElement) approveButton.disabled = false;
    if (isElement(pairingPrompt)) pairingPrompt.textContent = "waiting for explicit approval";
  } catch (error) {
    setRuntime("unavailable", "offline");
    setMessage(error instanceof Error ? error.message : "Could not load pairing request.", "pair-error");
    if (isElement(pairingPrompt)) pairingPrompt.textContent = "pairing unavailable";
  }
}

async function approvePairing() {
  if (!pairingId || !(approveButton instanceof HTMLButtonElement)) return;
  approveButton.disabled = true;
  setRuntime("approving");
  if (isElement(pairingPrompt)) pairingPrompt.textContent = "approving device";

  try {
    const response = await fetch(`/api/v1/pairings/${encodeURIComponent(pairingId)}/approve`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error(await errorMessage(response));

    setRuntime("approved", "online");
    setMessage("Approved. Return to the terminal; Waitloop will finish pairing automatically.", "pair-success");
    if (isElement(pairingPrompt)) pairingPrompt.textContent = "approved · return to terminal";
  } catch (error) {
    setRuntime("failed", "offline");
    setMessage(error instanceof Error ? error.message : "Approval failed.", "pair-error");
    if (Date.now() < expiresAt) approveButton.disabled = false;
    if (isElement(pairingPrompt)) pairingPrompt.textContent = "approval failed";
  }
}

approveButton?.addEventListener("click", () => void approvePairing());
void loadPairing();
