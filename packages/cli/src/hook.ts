import {
  finishTurn,
  readHookInput,
  readLatestAgentState,
  startTurn,
  transitionTurn,
  type LocalTurnState,
} from "./lifecycle.js";

export async function runClaudeCodeHook(): Promise<void> {
  const input = await readHookInput();
  const claudeSessionId = input?.session_id;
  const hook = input?.hook_event_name;
  if (typeof claudeSessionId !== "string" || typeof hook !== "string") return;

  if (hook === "UserPromptSubmit") {
    await startTurn("claude-code", claudeSessionId);
    return;
  }
  if (hook === "PermissionRequest" || hook === "Notification") {
    await transitionTurn("claude-code", claudeSessionId, "waiting");
    return;
  }
  if (hook === "Stop" || hook === "SessionEnd") {
    await finishTurn("claude-code", claudeSessionId, "completed");
    return;
  }
  if (hook === "StopFailure") {
    await finishTurn("claude-code", claudeSessionId, "failed");
  }
}

export function readLatestClaudeState(): Promise<LocalTurnState | null> {
  return readLatestAgentState("claude-code");
}
