from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    file_path.write_text(text.replace(old, new))


replace_once(
    "apps/web/public/agent.json",
    '    "candidateSummary": "MCP App recent activity is capped at four single-line entries without an internal scrollbar.",',
    '    "candidateSummary": "MCP App recent activity is capped at four non-scrolling rows; the 1.2-second idle App refresh loop is removed, connected Web tables use visibility-aware 1-10 second backoff, and failed lifecycle WebSockets reconnect with bounded backoff.",',
    "agent candidate summary",
)

replace_once(
    "docs/status.md",
    "The alpha.8 source candidate changes only compact history presentation in this area: `recent activity` is capped at the latest four chronological single-line rows, uses ellipsis for long rows, and has no internal scrollbar. `current trick` remains separate and authoritative.",
    "The alpha.8 source candidate changes compact history and request behavior in this area: `recent activity` is capped at the latest four chronological single-line rows, uses ellipsis for long rows, and has no internal scrollbar. `current trick` remains separate and authoritative. The 1.2-second idle `ui_get_game` loop is removed; Human-vs-bots state advances from mutation responses, explicit refresh, and one-shot refresh when the App becomes visible or focused.",
    "status App candidate",
)
replace_once(
    "docs/status.md",
    "- 89 unit/regression tests across rules, identity, controller fallback, lifecycle, CLI, MCP, and Human MCP App custody/presentation;",
    "- 95 unit/regression tests across rules, identity, controller fallback, lifecycle, CLI, MCP, Human MCP App custody/presentation, and browser request budgets;",
    "status test count",
)
replace_once(
    "docs/status.md",
    "- fixed four-row, non-scrolling recent activity contract;\n- read-only AbortSignal propagation and cancellable `wait_for_turn` polling;",
    "- fixed four-row, non-scrolling recent activity contract;\n- no continuous idle polling from the Human MCP App;\n- standalone connected/companion Room refresh stops while hidden and backs unchanged visible state off from 1 to 10 seconds;\n- lifecycle WebSocket failures reconnect with bounded backoff and respect page lifecycle;\n- read-only AbortSignal propagation and cancellable `wait_for_turn` polling;",
    "status request tests",
)
replace_once(
    "docs/status.md",
    "- clean-main invariant preventing manual deployment of uncommitted or feature-branch content.\n\nRate limiting remains abuse protection, not accounting.",
    "- clean-main invariant preventing manual deployment of uncommitted or feature-branch content;\n- browser request budgets that prohibit unbounded idle Worker polling, stop hidden-view refresh, and bound failed socket retries.\n\nRate limiting remains abuse protection, not accounting.",
    "status request security",
)

replace_once(
    "docs/design.md",
    "- refresh is explicit in addition to bounded automatic polling;",
    "- refresh is explicit; Human-vs-bots mutation responses are authoritative and the App performs no idle interval polling;",
    "design refresh rule",
)
replace_once(
    "docs/design.md",
    "The Human MCP App uses bounded state refresh while the iframe remains open. This is not a model loop or turn deadline.",
    "The Human MCP App does not continuously refresh while idle. Human-vs-bots actions return the authoritative post-Bot snapshot; manual refresh plus a one-shot visible/focus refresh repair stale presentation without generating a permanent Worker request stream. This is not a model loop or turn deadline.",
    "design App refresh",
)

replace_once(
    "docs/mcp.md",
    "The compact activity region shows the latest four authoritative history rows in chronological order. It has no internal scrollbar; long rows remain single-line with visual truncation. The authoritative current trick is displayed separately, so the move to beat remains visible even when older history is omitted from the compact view.\n\nThe App contains no external script/style dependency and performs no credentialed direct network request.",
    "The compact activity region shows the latest four authoritative history rows in chronological order. It has no internal scrollbar; long rows remain single-line with visual truncation. The authoritative current trick is displayed separately, so the move to beat remains visible even when older history is omitted from the compact view.\n\nThe Human-vs-bots App is action-driven rather than interval-driven: play/pass/hint responses already contain the authoritative post-automation snapshot. `ui_get_game` is used only for explicit refresh, reopen, error recovery, and a one-shot refresh when the App becomes visible or focused. An idle mounted App performs no recurring Worker request.\n\nThe App contains no external script/style dependency and performs no credentialed direct network request.",
    "MCP App request behavior",
)

replace_once(
    "docs/architecture.md",
    "The App also supports host-context changes, size notifications, display-mode requests, external-link requests, and teardown.\n\n### Human versus Agent ownership",
    "The App also supports host-context changes, size notifications, display-mode requests, external-link requests, and teardown.\n\n### Browser request budget\n\nThe Human-vs-bots MCP App is action-driven. Room mutations return the authoritative snapshot after deterministic Bot moves, so an open idle App does not poll the Worker. Explicit refresh, reopen/error recovery, and a one-shot visible/focus refresh use `ui_get_game`.\n\nThe standalone connected/companion Web table still needs remote updates while another Actor may act. It polls only while visible, starts at one second after visible state changes, doubles through 2/4/8 seconds, and caps unchanged state at ten seconds. Hidden/pagehide views stop the timer. Heartbeat-only `lastSeenAt` changes do not reset the backoff.\n\nFailed lifecycle WebSocket reconnects use exponential backoff up to 30 seconds and stop while hidden or torn down. This prevents a broken endpoint or abandoned view from becoming an unbounded Worker-invocation source.\n\n### Human versus Agent ownership",
    "architecture request budget",
)

replace_once(
    "AGENTS.md",
    "- `open_game(roomId)` may reopen only a still-valid local interactive Room.\n\nDo not claim Codex/Claude/Cursor/other Host UI support without testing the exact active product surface.",
    "- `open_game(roomId)` may reopen only a still-valid local interactive Room;\n- Human-vs-bots App state is action-driven: mutation responses are authoritative and an idle mounted App must not continuously call `ui_get_game`;\n- explicit/focus/visibility refresh must be one-shot and guarded against overlap;\n- any Web polling required for connected Actors must stop while hidden and use bounded backoff when visible state is unchanged;\n- failed WebSocket reconnects must use bounded backoff and page-lifecycle cleanup.\n\nDo not claim Codex/Claude/Cursor/other Host UI support without testing the exact active product surface.",
    "AGENTS request budget invariant",
)

replace_once(
    "docs/README.md",
    "95 unit/regression tests" if "95 unit/regression tests" in Path("docs/README.md").read_text() else "89 unit/regression tests",
    "95 unit/regression tests",
    "docs index test count",
)

print("request-budget documentation patches applied")
