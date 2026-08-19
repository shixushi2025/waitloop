export function historyDelta(previous, current) {
  const before = Array.isArray(previous?.state?.history) ? previous.state.history.length : 0;
  const after = Array.isArray(current?.state?.history) ? current.state.history : [];
  if (before < 0 || before > after.length) return [];
  return after.slice(before);
}

export function recentHistory(current, limit = 6) {
  const history = Array.isArray(current?.state?.history) ? current.state.history : [];
  return history.slice(Math.max(0, history.length - Math.max(1, limit)));
}

export function historyKey(entry, index) {
  if (!entry || typeof entry !== "object") return `unknown-${index}`;
  const cards = Array.isArray(entry.cards) ? entry.cards.map((card) => card?.id ?? "?").join(",") : "";
  return `${index}:${entry.type ?? "?"}:${entry.playerId ?? "?"}:${cards}`;
}
