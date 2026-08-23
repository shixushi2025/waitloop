export function companionEmptyStateText(status) {
  if (status === "connected") return "agent connected · no comments yet";
  if (status === "connecting") return "credential claimed · waiting for MCP connection";
  if (status === "disconnected") return "agent away · no comments yet";
  return "agent not joined · no comments yet";
}
