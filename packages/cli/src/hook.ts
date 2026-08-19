import {
  readHookInput,
  readLatestAgentState,
  removeTurnState,
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
  if (hook === "SessionEnd") {
    await removeTurnState("claude-code", claudeSessionId);
    return;
  }
  if (hook === "PermissionRequest" || hook === "Notification") {
    await transitionTurn("claude-code", claudeSessionId, "waiting");
    return;
  }
  if (hook === "Stop") {
    await transitionTurn("claude-code", claudeSessionId, "completed");
    await removeTurnState("claude-code", claudeSessionId);
    return;
  }
  if (hook === "StopFailure") {
    await transitionTurn("claude-code", claudeSessionId, "failed");
    await removeTurnState("claude-code", claudeSessionId);
  }
}

export function readLatestClaudeState(): Promise<LocalTurnState | null> {
  return readLatestAgentState("claude-code");
}
