from __future__ import annotations

import json
from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    file.write_text(text.replace(old, new))


def patch_mcp_app() -> None:
    path = "packages/cli/src/mcp-app.ts"
    replace_once(
        path,
        'export const MCP_APP_RECENT_ACTIVITY_LIMIT = 4;\n',
        'export const MCP_APP_RECENT_ACTIVITY_LIMIT = 4;\n'
        'export const MCP_APP_REFRESH_MIN_DELAY_MS = 5000;\n'
        'export const MCP_APP_REFRESH_MAX_DELAY_MS = 30000;\n',
        "MCP App exported refresh constants",
    )
    replace_once(
        path,
        '      var RECENT_ACTIVITY_LIMIT = ${MCP_APP_RECENT_ACTIVITY_LIMIT};\n',
        '      var RECENT_ACTIVITY_LIMIT = ${MCP_APP_RECENT_ACTIVITY_LIMIT};\n'
        '      var REFRESH_MIN_DELAY_MS = ${MCP_APP_REFRESH_MIN_DELAY_MS};\n'
        '      var REFRESH_MAX_DELAY_MS = ${MCP_APP_REFRESH_MAX_DELAY_MS};\n',
        "MCP App embedded refresh constants",
    )
    replace_once(
        path,
        '        actionBusy: false,\n        refreshBusy: false,\n        fallbackUrl: "https://waitloop.run/game.html"\n',
        '        actionBusy: false,\n'
        '        refreshBusy: false,\n'
        '        refreshTimer: null,\n'
        '        refreshDelayMs: REFRESH_MIN_DELAY_MS,\n'
        '        fallbackUrl: "https://waitloop.run/game.html"\n',
        "MCP App refresh state",
    )
    replace_once(
        path,
        '      function canUseTools() {\n',
        '      function refreshSignature(payload) {\n'
        '        var snapshot = payload && payload.snapshot;\n'
        '        if (!snapshot) return "";\n'
        '        var history = snapshot.state && Array.isArray(snapshot.state.history) ? snapshot.state.history : [];\n'
        '        return [\n'
        '          snapshot.revision,\n'
        '          snapshot.status,\n'
        '          snapshot.roomPhase || "",\n'
        '          snapshot.currentPlayerId || "",\n'
        '          history.length\n'
        '        ].join("|");\n'
        '      }\n\n'
        '      function stopRefresh() {\n'
        '        if (state.refreshTimer !== null) window.clearTimeout(state.refreshTimer);\n'
        '        state.refreshTimer = null;\n'
        '      }\n\n'
        '      function scheduleRefresh() {\n'
        '        stopRefresh();\n'
        '        if (\n'
        '          !state.connected ||\n'
        '          !state.payload ||\n'
        '          state.payload.snapshot.status === "finished" ||\n'
        '          !canUseTools() ||\n'
        '          document.visibilityState !== "visible"\n'
        '        ) return;\n'
        '        state.refreshTimer = window.setTimeout(function () {\n'
        '          state.refreshTimer = null;\n'
        '          void refresh(true);\n'
        '        }, state.refreshDelayMs);\n'
        '      }\n\n'
        '      function canUseTools() {\n',
        "MCP App bounded refresh helpers",
    )
    replace_once(
        path,
        '          setMessage(winner === "you" ? "You won." : winner + " won.");\n'
        '        } else if (canAct(snapshot)) setMessage("Your turn.");\n',
        '          setMessage(winner === "you" ? "You won." : winner + " won.");\n'
        '          stopRefresh();\n'
        '        } else if (canAct(snapshot)) setMessage("Your turn.");\n',
        "MCP App stop refresh on finish",
    )
    replace_once(
        path,
        '        var callArgs = Object.assign({}, args || {}, { uiToken: state.uiToken });\n'
        '        if (!quiet) {\n'
        '          state.actionBusy = true;\n',
        '        var callArgs = Object.assign({}, args || {}, { uiToken: state.uiToken });\n'
        '        var previousSignature = refreshSignature(state.payload);\n'
        '        if (!quiet) {\n'
        '          stopRefresh();\n'
        '          state.actionBusy = true;\n',
        "MCP App action refresh preparation",
    )
    replace_once(
        path,
        '          var payload = payloadFromResult(result);\n'
        '          if (!payload) throw new Error("Waitloop returned an invalid game payload.");\n'
        '          render(payload);\n'
        '          return payload;\n',
        '          var payload = payloadFromResult(result);\n'
        '          if (!payload) throw new Error("Waitloop returned an invalid game payload.");\n'
        '          var nextSignature = refreshSignature(payload);\n'
        '          if (name === "ui_get_game") {\n'
        '            state.refreshDelayMs = nextSignature !== previousSignature\n'
        '              ? REFRESH_MIN_DELAY_MS\n'
        '              : Math.min(REFRESH_MAX_DELAY_MS, Math.max(REFRESH_MIN_DELAY_MS, state.refreshDelayMs * 2));\n'
        '          } else {\n'
        '            state.refreshDelayMs = REFRESH_MIN_DELAY_MS;\n'
        '          }\n'
        '          render(payload);\n'
        '          scheduleRefresh();\n'
        '          return payload;\n',
        "MCP App bounded refresh update",
    )
    replace_once(
        path,
        '      async function refresh(quiet) {\n'
        '        if (!state.payload || state.refreshBusy) return;\n'
        '        state.refreshBusy = true;\n'
        '        try { await callTool("ui_get_game", { roomId: state.payload.roomId }, Boolean(quiet)); }\n'
        '        catch (error) { if (!quiet) setMessage(error instanceof Error ? error.message : String(error), "error"); }\n'
        '        finally { state.refreshBusy = false; }\n'
        '      }\n\n'
        '      function refreshWhenVisible() {\n'
        '        if (document.visibilityState !== "visible" || !state.payload || !canUseTools() || state.actionBusy) return;\n'
        '        void refresh(true);\n'
        '      }\n',
        '      async function refresh(quiet) {\n'
        '        if (!state.payload || state.refreshBusy) return;\n'
        '        if (state.actionBusy) { scheduleRefresh(); return; }\n'
        '        state.refreshBusy = true;\n'
        '        try {\n'
        '          await callTool("ui_get_game", { roomId: state.payload.roomId }, Boolean(quiet));\n'
        '        } catch (error) {\n'
        '          state.refreshDelayMs = Math.min(\n'
        '            REFRESH_MAX_DELAY_MS,\n'
        '            Math.max(REFRESH_MIN_DELAY_MS, state.refreshDelayMs * 2)\n'
        '          );\n'
        '          if (!quiet) setMessage(error instanceof Error ? error.message : String(error), "error");\n'
        '          scheduleRefresh();\n'
        '        } finally {\n'
        '          state.refreshBusy = false;\n'
        '        }\n'
        '      }\n\n'
        '      function refreshWhenVisible() {\n'
        '        if (document.visibilityState !== "visible" || !state.payload || !canUseTools() || state.actionBusy) return;\n'
        '        stopRefresh();\n'
        '        state.refreshDelayMs = REFRESH_MIN_DELAY_MS;\n'
        '        void refresh(true);\n'
        '      }\n',
        "MCP App visible refresh behavior",
    )
    replace_once(
        path,
        '          if (state.payload) render(state.payload);\n',
        '          if (state.payload) {\n'
        '            render(state.payload);\n'
        '            scheduleRefresh();\n'
        '          }\n',
        "MCP App connect refresh schedule",
    )
    replace_once(
        path,
        '          var payload = payloadFromResult(incoming.params || {});\n'
        '          if (payload) render(payload); else setMessage("The Host did not forward a readable Waitloop tool result.", "error");\n',
        '          var payload = payloadFromResult(incoming.params || {});\n'
        '          if (payload) {\n'
        '            state.refreshDelayMs = REFRESH_MIN_DELAY_MS;\n'
        '            render(payload);\n'
        '            scheduleRefresh();\n'
        '          } else setMessage("The Host did not forward a readable Waitloop tool result.", "error");\n',
        "MCP App initial tool-result refresh schedule",
    )
    replace_once(
        path,
        '        if (incoming.method === "ui/resource-teardown" && Object.prototype.hasOwnProperty.call(incoming, "id")) {\n'
        '          state.connected = false;\n'
        '          send({ jsonrpc: "2.0", id: incoming.id, result: {} });\n'
        '        }\n',
        '        if (incoming.method === "ui/resource-teardown" && Object.prototype.hasOwnProperty.call(incoming, "id")) {\n'
        '          state.connected = false;\n'
        '          stopRefresh();\n'
        '          send({ jsonrpc: "2.0", id: incoming.id, result: {} });\n'
        '        }\n',
        "MCP App teardown refresh stop",
    )
    replace_once(
        path,
        '      refreshButton.addEventListener("click", function () { void refresh(false); });\n',
        '      refreshButton.addEventListener("click", function () {\n'
        '        state.refreshDelayMs = REFRESH_MIN_DELAY_MS;\n'
        '        void refresh(false);\n'
        '      });\n',
        "MCP App manual refresh reset",
    )
    replace_once(
        path,
        '      document.addEventListener("visibilitychange", function () {\n'
        '        if (document.visibilityState === "visible") refreshWhenVisible();\n'
        '      });\n'
        '      window.addEventListener("focus", refreshWhenVisible);\n',
        '      document.addEventListener("visibilitychange", function () {\n'
        '        if (document.visibilityState !== "visible") {\n'
        '          stopRefresh();\n'
        '          return;\n'
        '        }\n'
        '        refreshWhenVisible();\n'
        '      });\n'
        '      window.addEventListener("focus", refreshWhenVisible);\n'
        '      window.addEventListener("pagehide", stopRefresh);\n',
        "MCP App visibility lifecycle",
    )


def patch_tests() -> None:
    Path("packages/cli/test/mcp-app.test.ts").write_text(
        '''import { describe, expect, it } from "vitest";\n\nimport {\n  MCP_APP_RECENT_ACTIVITY_LIMIT,\n  MCP_APP_REFRESH_MAX_DELAY_MS,\n  MCP_APP_REFRESH_MIN_DELAY_MS,\n  WAITLOOP_GAME_APP_HTML,\n} from "../src/mcp-app.js";\n\ndescribe("Human MCP App presentation", () => {\n  it("shows a bounded recent activity list without an internal scrollbar", () => {\n    expect(MCP_APP_RECENT_ACTIVITY_LIMIT).toBe(4);\n    expect(WAITLOOP_GAME_APP_HTML).toContain("var RECENT_ACTIVITY_LIMIT = 4;");\n    expect(WAITLOOP_GAME_APP_HTML).toContain("slice(-RECENT_ACTIVITY_LIMIT)");\n    expect(WAITLOOP_GAME_APP_HTML).toContain("className = \\\"activity-row\\\"");\n    expect(WAITLOOP_GAME_APP_HTML).toContain(".activity-row { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");\n    expect(WAITLOOP_GAME_APP_HTML).not.toContain("max-height: 98px");\n    expect(WAITLOOP_GAME_APP_HTML).not.toContain("overflow: auto");\n  });\n\n  it("keeps automatic refresh visible-only and bounded between five and thirty seconds", () => {\n    expect(MCP_APP_REFRESH_MIN_DELAY_MS).toBe(5_000);\n    expect(MCP_APP_REFRESH_MAX_DELAY_MS).toBe(30_000);\n    expect(WAITLOOP_GAME_APP_HTML).toContain("var REFRESH_MIN_DELAY_MS = 5000;");\n    expect(WAITLOOP_GAME_APP_HTML).toContain("var REFRESH_MAX_DELAY_MS = 30000;");\n    expect(WAITLOOP_GAME_APP_HTML).toContain("scheduleRefresh");\n    expect(WAITLOOP_GAME_APP_HTML).toContain("stopRefresh");\n    expect(WAITLOOP_GAME_APP_HTML).toContain('document.visibilityState !== "visible"');\n    expect(WAITLOOP_GAME_APP_HTML).toContain("Math.min(REFRESH_MAX_DELAY_MS");\n    expect(WAITLOOP_GAME_APP_HTML).not.toContain("}, 1200)");\n  });\n});\n'''
    )
    Path("apps/web/public/request-budget.test.ts").write_text(
        '''import { readFileSync } from "node:fs";\nimport { resolve } from "node:path";\n\nimport { describe, expect, it } from "vitest";\n\nconst root = resolve(import.meta.dirname, "../../..");\n\nfunction source(path: string) {\n  return readFileSync(resolve(root, path), "utf8");\n}\n\ndescribe("browser request budgets", () => {\n  it("uses visible-only bounded fallback refresh in the Human MCP App", () => {\n    const app = source("packages/cli/src/mcp-app.ts");\n    expect(app).toContain("MCP_APP_REFRESH_MIN_DELAY_MS = 5000");\n    expect(app).toContain("MCP_APP_REFRESH_MAX_DELAY_MS = 30000");\n    expect(app).toContain("scheduleRefresh");\n    expect(app).toContain("stopRefresh");\n    expect(app).toContain('document.visibilityState !== "visible"');\n    expect(app).toContain('window.addEventListener("pagehide", stopRefresh)');\n    expect(app).not.toContain("}, 1200)");\n  });\n\n  it("backs visible connected-room polling off and stops it while hidden", () => {\n    const game = source("apps/web/public/game.js");\n    expect(game).toContain("shouldRefreshRoom(current, !document.hidden)");\n    expect(game).toContain("nextRoomRefreshDelay");\n    expect(game).toContain("stopRoomRefresh");\n    expect(game).toContain("if (document.hidden)");\n    expect(game).not.toContain("}, 1000);\\n}");\n  });\n\n  it("backs failed lifecycle WebSocket reconnects off and restores safely after page lifecycle changes", () => {\n    const app = source("apps/web/public/app.js");\n    expect(app).toContain("MAX_SESSION_RECONNECT_DELAY_MS");\n    expect(app).toContain("scheduleSessionReconnect");\n    expect(app).toContain("document.hidden");\n    expect(app).toContain('window.addEventListener("pagehide"');\n    expect(app).toContain('window.addEventListener("pageshow"');\n    expect(app).not.toContain("window.setTimeout(() => connectSessionSocket(id), 1500)");\n  });\n});\n'''
    )


def patch_docs() -> None:
    manifest_path = Path("apps/web/public/agent.json")
    manifest = json.loads(manifest_path.read_text())
    manifest["cli"]["candidateSummary"] = (
        "MCP App recent activity is capped at four non-scrolling rows; Human actions update immediately from mutation responses, "
        "while a visible-only safety refresh backs off from 5 to 30 seconds and stops when hidden or torn down. Connected Web "
        "tables retain visibility-aware 1-10 second backoff, and failed lifecycle WebSockets reconnect with bounded backoff."
    )
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    replace_once(
        "docs/mcp.md",
        "The Human-vs-bots App is action-driven rather than interval-driven: play/pass/hint responses already contain the authoritative post-automation snapshot. `ui_get_game` is used only for explicit refresh, reopen, error recovery, and a one-shot refresh when the App becomes visible or focused. An idle mounted App performs no recurring Worker request.\n",
        "The Human-vs-bots App is action-driven: play/pass/hint responses already contain the authoritative post-automation snapshot, so normal interaction never waits for polling. A low-frequency safety refresh remains for stale or multiply opened views: while the App is visible it starts at 5 seconds and exponentially backs off to a maximum 30-second interval when state is unchanged. It resets after visible state changes or Human actions and stops while hidden, on pagehide, after teardown, or when the game finishes. Explicit refresh and focus/visibility recovery remain immediate and overlap-guarded.\n",
        "MCP bounded refresh documentation",
    )
    replace_once(
        "docs/status.md",
        "The alpha.8 source candidate changes compact history and request behavior in this area: `recent activity` is capped at the latest four chronological single-line rows, uses ellipsis for long rows, and has no internal scrollbar. `current trick` remains separate and authoritative. The 1.2-second idle `ui_get_game` loop is removed; Human-vs-bots state advances from mutation responses, explicit refresh, and one-shot refresh when the App becomes visible or focused.\n",
        "The alpha.8 source candidate changes compact history and request behavior in this area: `recent activity` is capped at the latest four chronological single-line rows, uses ellipsis for long rows, and has no internal scrollbar. `current trick` remains separate and authoritative. Human actions still update immediately from their mutation responses. The former 1.2-second loop is replaced by a visible-only safety refresh that backs off through 5, 10, 20, and 30 seconds, resets on visible state changes or Human actions, and stops when hidden, torn down, finished, or unloaded.\n",
        "Status bounded refresh documentation",
    )
    replace_once(
        "AGENTS.md",
        "- Human-vs-bots App state is action-driven: mutation responses are authoritative and an idle mounted App must not continuously call `ui_get_game`;\n- explicit/focus/visibility refresh must be one-shot and guarded against overlap;\n",
        "- Human-vs-bots App state is action-driven: mutation responses are authoritative, so normal Human actions must update immediately without waiting for polling;\n- safety refresh may run only while visible, must start no faster than 5 seconds, back off to a maximum 30-second interval when unchanged, and stop on hidden/pagehide/teardown/finish;\n- explicit/focus/visibility refresh must be immediate, one-shot, and guarded against overlap;\n",
        "Repository bounded refresh invariant",
    )


patch_mcp_app()
patch_tests()
patch_docs()
print("bounded MCP App refresh patch applied")
