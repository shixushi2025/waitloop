export const WAITLOOP_GAME_UI_URI = "ui://waitloop/doudizhu/v1";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

export const WAITLOOP_GAME_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Waitloop Dou Dizhu</title>
  <style>
    :root {
      color-scheme: light dark;
      --wl-bg: var(--color-background-primary, #0d1010);
      --wl-panel: var(--color-background-secondary, #171b1b);
      --wl-panel-2: var(--color-background-tertiary, #202626);
      --wl-text: var(--color-text-primary, #f4f6f4);
      --wl-muted: var(--color-text-secondary, #aab3ae);
      --wl-faint: var(--color-text-tertiary, #7d8983);
      --wl-border: var(--color-border-secondary, #34403a);
      --wl-accent: var(--color-text-success, #8ee6a4);
      --wl-danger: var(--color-text-danger, #ff9c9c);
      --wl-warning: var(--color-text-warning, #ffd38a);
      --wl-radius: var(--border-radius-md, 10px);
      --wl-font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --wl-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; color: var(--wl-text); font-family: var(--wl-font); }
    body { min-width: 280px; }
    button { font: inherit; }
    .app { display: grid; gap: 12px; padding: 12px; background: var(--wl-bg); border: 1px solid var(--wl-border); border-radius: var(--wl-radius); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .brand { font-family: var(--wl-mono); font-size: 15px; font-weight: 700; letter-spacing: .02em; }
    .brand span { color: var(--wl-accent); }
    .head-actions { display: flex; gap: 6px; }
    .icon-button, .action, .link-button { border: 1px solid var(--wl-border); border-radius: 8px; background: var(--wl-panel); color: var(--wl-text); cursor: pointer; }
    .icon-button { padding: 6px 9px; font-size: 12px; }
    .icon-button:hover, .action:hover, .link-button:hover { border-color: var(--wl-accent); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .status { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .status-item { min-width: 0; padding: 8px; background: var(--wl-panel); border-radius: 8px; }
    .status-item small { display: block; color: var(--wl-faint); font-family: var(--wl-mono); font-size: 10px; text-transform: uppercase; }
    .status-item strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; font-size: 12px; }
    .players { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .player { min-width: 0; padding: 9px; border: 1px solid var(--wl-border); border-radius: 8px; background: var(--wl-panel); }
    .player.current { border-color: var(--wl-accent); box-shadow: inset 0 0 0 1px var(--wl-accent); }
    .player-name { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; font-weight: 700; }
    .player-meta { margin-top: 5px; color: var(--wl-muted); font-size: 11px; }
    .table { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
    .panel { min-width: 0; padding: 9px; background: var(--wl-panel); border-radius: 8px; }
    .label { margin: 0 0 7px; color: var(--wl-faint); font-family: var(--wl-mono); font-size: 10px; text-transform: uppercase; }
    .trick { min-height: 34px; font-family: var(--wl-mono); font-size: 12px; line-height: 1.45; }
    .activity { min-height: 34px; max-height: 98px; overflow: auto; display: grid; gap: 4px; color: var(--wl-muted); font-family: var(--wl-mono); font-size: 10px; }
    .hand-panel { padding: 9px; background: var(--wl-panel); border-radius: 8px; }
    .hand { display: flex; flex-wrap: wrap; gap: 6px; min-height: 42px; }
    .card { min-width: 34px; height: 42px; padding: 0 7px; border: 1px solid var(--wl-border); border-radius: 7px; background: var(--wl-panel-2); color: var(--wl-text); font-family: var(--wl-mono); font-weight: 700; cursor: pointer; transition: transform .12s ease, border-color .12s ease, background .12s ease; }
    .card:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--wl-accent); }
    .card.selected { transform: translateY(-5px); border-color: var(--wl-accent); background: color-mix(in srgb, var(--wl-accent) 18%, var(--wl-panel-2)); }
    .card.red { color: #ff8d8d; }
    .selection { margin-top: 8px; min-height: 18px; color: var(--wl-muted); font-size: 11px; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .action { padding: 8px 12px; font-size: 12px; font-weight: 650; }
    .action.primary { background: var(--wl-accent); border-color: var(--wl-accent); color: #08220f; }
    .message { min-height: 18px; color: var(--wl-muted); font-size: 11px; line-height: 1.45; }
    .message.error { color: var(--wl-danger); }
    .message.warning { color: var(--wl-warning); }
    .fallback { display: none; padding: 9px; border: 1px dashed var(--wl-border); border-radius: 8px; color: var(--wl-muted); font-size: 11px; line-height: 1.45; }
    .fallback.visible { display: block; }
    .link-button { margin-top: 7px; padding: 7px 10px; }
    .loading { padding: 24px 12px; text-align: center; color: var(--wl-muted); font-family: var(--wl-mono); font-size: 12px; }
    @media (max-width: 560px) {
      .status { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .players { grid-template-columns: 1fr; }
      .table { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="app" id="app-root">
    <header class="head">
      <div class="brand">waitloop<span>_</span> doudizhu</div>
      <div class="head-actions">
        <button class="icon-button" id="expand" type="button" hidden>expand</button>
        <button class="icon-button" id="refresh" type="button" disabled>refresh</button>
      </div>
    </header>

    <div class="loading" id="loading">waiting for the game result…</div>

    <section id="game" hidden>
      <div class="status">
        <div class="status-item"><small>role</small><strong id="role">-</strong></div>
        <div class="status-item"><small>turn</small><strong id="turn">-</strong></div>
        <div class="status-item"><small>status</small><strong id="status">-</strong></div>
        <div class="status-item"><small>revision</small><strong id="revision">-</strong></div>
      </div>

      <div class="players" id="players"></div>

      <div class="table">
        <div class="panel">
          <p class="label">current trick</p>
          <div class="trick" id="trick">none</div>
        </div>
        <div class="panel">
          <p class="label">recent activity</p>
          <div class="activity" id="activity">no moves yet</div>
        </div>
      </div>

      <div class="hand-panel">
        <p class="label">your hand</p>
        <div class="hand" id="hand"></div>
        <div class="selection" id="selection">waiting for your turn</div>
      </div>

      <div class="actions">
        <button class="action primary" id="play" type="button" disabled>play selected</button>
        <button class="action" id="pass" type="button" disabled>pass</button>
        <button class="action" id="hint" type="button" disabled>hint</button>
        <button class="action" id="clear" type="button" disabled>clear</button>
      </div>
    </section>

    <div class="message" id="message"></div>
    <aside class="fallback" id="fallback">
      <div id="fallback-message"></div>
      <button class="link-button" id="open-web" type="button">open separate web table</button>
      <div id="fallback-url"></div>
    </aside>
  </main>

  <script>
    (function () {
      "use strict";

      var PROTOCOL_VERSION = "2026-01-26";
      var state = {
        connected: false,
        hostCapabilities: {},
        hostContext: {},
        payload: null,
        selected: new Set(),
        hintCursor: 0,
        actionBusy: false,
        pollBusy: false,
        pollTimer: null,
        fallbackUrl: "https://waitloop.run/game.html"
      };
      var pending = new Map();
      var nextId = 1;

      var loading = document.getElementById("loading");
      var game = document.getElementById("game");
      var role = document.getElementById("role");
      var turn = document.getElementById("turn");
      var status = document.getElementById("status");
      var revision = document.getElementById("revision");
      var players = document.getElementById("players");
      var trick = document.getElementById("trick");
      var activity = document.getElementById("activity");
      var hand = document.getElementById("hand");
      var selection = document.getElementById("selection");
      var playButton = document.getElementById("play");
      var passButton = document.getElementById("pass");
      var hintButton = document.getElementById("hint");
      var clearButton = document.getElementById("clear");
      var refreshButton = document.getElementById("refresh");
      var expandButton = document.getElementById("expand");
      var message = document.getElementById("message");
      var fallback = document.getElementById("fallback");
      var fallbackMessage = document.getElementById("fallback-message");
      var fallbackUrl = document.getElementById("fallback-url");
      var openWebButton = document.getElementById("open-web");

      function send(value) {
        window.parent.postMessage(value, "*");
      }

      function notify(method, params) {
        send({ jsonrpc: "2.0", method: method, params: params || {} });
      }

      function request(method, params, timeoutMs) {
        var id = "waitloop-ui-" + String(nextId++);
        return new Promise(function (resolve, reject) {
          var timeout = window.setTimeout(function () {
            pending.delete(id);
            reject(new Error("Timed out waiting for " + method + "."));
          }, timeoutMs || 30000);
          pending.set(id, {
            resolve: function (value) { window.clearTimeout(timeout); resolve(value); },
            reject: function (error) { window.clearTimeout(timeout); reject(error); }
          });
          send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
        });
      }

      function firstText(result) {
        if (!result || !Array.isArray(result.content)) return null;
        for (var index = 0; index < result.content.length; index += 1) {
          var item = result.content[index];
          if (item && item.type === "text" && typeof item.text === "string") return item.text;
        }
        return null;
      }

      function payloadFromResult(result) {
        if (result && result.structuredContent && typeof result.structuredContent === "object") {
          return result.structuredContent;
        }
        var text = firstText(result);
        if (!text) return null;
        try { return JSON.parse(text); } catch (_error) { return null; }
      }

      function errorFromResult(result) {
        var payload = payloadFromResult(result);
        if (payload && payload.error) {
          if (typeof payload.error.message === "string") return payload.error.message;
          if (typeof payload.error === "string") return payload.error;
        }
        return firstText(result) || "Waitloop tool call failed.";
      }

      function setMessage(text, kind) {
        message.textContent = text || "";
        message.className = "message" + (kind ? " " + kind : "");
      }

      function showFallback(payload, text) {
        var details = payload && payload.fallback ? payload.fallback : null;
        state.fallbackUrl = details && typeof details.webUrl === "string"
          ? details.webUrl
          : "https://waitloop.run/game.html";
        fallbackMessage.textContent = text || (details && details.message) || "This Host may not support MCP Apps interaction.";
        fallbackUrl.textContent = state.fallbackUrl + " (starts a separate browser game)";
        fallback.classList.add("visible");
      }

      function rankLabel(value) {
        var labels = { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "SJ", 17: "BJ" };
        return labels[value] || String(value);
      }

      function suitSymbol(value) {
        return { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[value] || "";
      }

      function isRedSuit(value) {
        return value === "diamonds" || value === "hearts";
      }

      function seatLabel(snapshot, seatId) {
        if (!snapshot || !seatId) return "-";
        if (seatId === snapshot.viewerSeatId) return "you";
        if (Array.isArray(snapshot.seats)) {
          var seat = snapshot.seats.find(function (item) { return item && item.id === seatId; });
          if (seat && typeof seat.label === "string") return seat.label;
        }
        return seatId;
      }

      function actionLabel(snapshot, entry) {
        if (!entry || typeof entry !== "object") return "";
        var who = seatLabel(snapshot, entry.playerId);
        if (entry.type === "pass") return who + " passed";
        var cards = Array.isArray(entry.cards)
          ? entry.cards.map(function (card) { return rankLabel(card.rank); }).join(" ")
          : "";
        var pattern = entry.pattern && typeof entry.pattern.kind === "string" ? entry.pattern.kind : "play";
        return who + " · " + pattern + (cards ? " · " + cards : "");
      }

      function canAct(snapshot) {
        return Boolean(
          snapshot &&
          snapshot.status === "playing" &&
          snapshot.currentPlayerId === snapshot.viewerSeatId &&
          snapshot.controls &&
          snapshot.controls.canPlay === true
        );
      }

      function normalizeSelection(snapshot) {
        var cards = snapshot && snapshot.state && Array.isArray(snapshot.state.myHand) ? snapshot.state.myHand : [];
        var valid = new Set(cards.map(function (card) { return card.id; }));
        Array.from(state.selected).forEach(function (id) {
          if (!valid.has(id)) state.selected.delete(id);
        });
        if (!canAct(snapshot)) state.selected.clear();
      }

      function renderPlayers(snapshot) {
        players.replaceChildren();
        var list = snapshot && snapshot.state && Array.isArray(snapshot.state.players) ? snapshot.state.players : [];
        list.forEach(function (player) {
          var row = document.createElement("div");
          row.className = "player" + (snapshot.currentPlayerId === player.id ? " current" : "");
          var name = document.createElement("div");
          name.className = "player-name";
          var label = document.createElement("span");
          label.textContent = seatLabel(snapshot, player.id);
          var marker = document.createElement("span");
          marker.textContent = snapshot.currentPlayerId === player.id ? ">" : "";
          name.append(label, marker);
          var meta = document.createElement("div");
          meta.className = "player-meta";
          meta.textContent = String(player.role || "pending") + " · " + String(player.remaining || 0) + " cards";
          row.append(name, meta);
          players.append(row);
        });
      }

      function renderHand(snapshot) {
        hand.replaceChildren();
        var cards = snapshot && snapshot.state && Array.isArray(snapshot.state.myHand) ? snapshot.state.myHand : [];
        var enabled = canAct(snapshot) && !state.actionBusy;
        cards.forEach(function (card) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "card" + (state.selected.has(card.id) ? " selected" : "") + (isRedSuit(card.suit) ? " red" : "");
          button.textContent = rankLabel(card.rank) + suitSymbol(card.suit);
          button.disabled = !enabled;
          button.setAttribute("aria-pressed", state.selected.has(card.id) ? "true" : "false");
          button.addEventListener("click", function () {
            if (!canAct(state.payload && state.payload.snapshot) || state.actionBusy) return;
            if (state.selected.has(card.id)) state.selected.delete(card.id);
            else state.selected.add(card.id);
            render(state.payload);
          });
          hand.append(button);
        });
      }

      function renderActions(snapshot) {
        var active = canAct(snapshot) && !state.actionBusy;
        var controls = snapshot && snapshot.controls ? snapshot.controls : {};
        playButton.disabled = !active || state.selected.size === 0;
        passButton.disabled = !active || controls.canPass !== true;
        hintButton.disabled = !active || controls.canHint !== true;
        clearButton.disabled = state.actionBusy || state.selected.size === 0;
        refreshButton.disabled = state.actionBusy || !state.connected || !state.hostCapabilities.serverTools;
        if (state.actionBusy) selection.textContent = "applying action…";
        else if (!canAct(snapshot)) selection.textContent = snapshot.status === "finished" ? "game finished" : "waiting for your turn";
        else if (state.selected.size === 0) selection.textContent = "select one or more cards";
        else selection.textContent = String(state.selected.size) + " card" + (state.selected.size === 1 ? "" : "s") + " selected";
      }

      function render(payload) {
        if (!payload || payload.kind !== "waitloop.mcp-app.game" || !payload.snapshot) return;
        state.payload = payload;
        state.fallbackUrl = payload.fallback && payload.fallback.webUrl ? payload.fallback.webUrl : state.fallbackUrl;
        var snapshot = payload.snapshot;
        normalizeSelection(snapshot);
        loading.hidden = true;
        game.hidden = false;
        fallback.classList.remove("visible");

        role.textContent = snapshot.state && snapshot.state.role ? snapshot.state.role : "-";
        turn.textContent = seatLabel(snapshot, snapshot.currentPlayerId);
        status.textContent = snapshot.status || snapshot.roomPhase || "-";
        revision.textContent = String(snapshot.revision);
        renderPlayers(snapshot);

        var last = snapshot.state ? snapshot.state.lastPlay : null;
        trick.textContent = last ? actionLabel(snapshot, last) : "none";
        var history = snapshot.state && Array.isArray(snapshot.state.history) ? snapshot.state.history.slice(-8) : [];
        activity.replaceChildren();
        if (history.length === 0) activity.textContent = "no moves yet";
        else history.forEach(function (entry) {
          var line = document.createElement("div");
          line.textContent = actionLabel(snapshot, entry);
          activity.append(line);
        });

        renderHand(snapshot);
        renderActions(snapshot);
        if (snapshot.status === "finished") {
          var winner = snapshot.state && snapshot.state.winnerId ? seatLabel(snapshot, snapshot.state.winnerId) : "unknown";
          setMessage(winner === "you" ? "You won." : winner + " won.");
          stopPolling();
        } else if (canAct(snapshot)) setMessage("Your turn.");
        else setMessage("Waiting for " + seatLabel(snapshot, snapshot.currentPlayerId) + ".");
        schedulePolling();
      }

      async function callTool(name, args, quiet) {
        if (!state.connected || !state.hostCapabilities.serverTools) {
          showFallback(state.payload, "This Host rendered the view but does not proxy MCP server tools, so inline actions are unavailable.");
          throw new Error("Host does not support MCP App server tool calls.");
        }
        if (!quiet) {
          state.actionBusy = true;
          if (state.payload) renderActions(state.payload.snapshot);
        }
        try {
          var result = await request("tools/call", { name: name, arguments: args || {} }, 30000);
          if (result && result.isError) throw new Error(errorFromResult(result));
          var payload = payloadFromResult(result);
          if (!payload) throw new Error("Waitloop returned an invalid game payload.");
          render(payload);
          return payload;
        } finally {
          if (!quiet) {
            state.actionBusy = false;
            if (state.payload) renderActions(state.payload.snapshot);
          }
        }
      }

      function currentArgs() {
        var payload = state.payload;
        var snapshot = payload && payload.snapshot;
        if (!payload || !snapshot) throw new Error("Game is not ready.");
        return { roomId: payload.roomId, expectedRevision: snapshot.revision };
      }

      async function refresh(quiet) {
        if (!state.payload || state.pollBusy) return;
        state.pollBusy = true;
        try {
          await callTool("ui_get_game", { roomId: state.payload.roomId }, Boolean(quiet));
        } catch (error) {
          if (!quiet) setMessage(error instanceof Error ? error.message : String(error), "error");
        } finally {
          state.pollBusy = false;
        }
      }

      async function playSelected() {
        try {
          var args = currentArgs();
          args.cardIds = Array.from(state.selected);
          await callTool("ui_play_cards", args, false);
          state.selected.clear();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error), "error");
          await refresh(true);
        }
      }

      async function passTurn() {
        try {
          await callTool("ui_pass", currentArgs(), false);
          state.selected.clear();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error), "error");
          await refresh(true);
        }
      }

      async function hint() {
        try {
          var args = currentArgs();
          args.cursor = state.hintCursor;
          var payload = await callTool("ui_hint", args, false);
          if (payload && payload.hint && Array.isArray(payload.hint.cardIds)) {
            state.selected = new Set(payload.hint.cardIds);
            state.hintCursor = Number(payload.hint.index || 0) + 1;
            setMessage("Hint: " + String(payload.hint.label || "suggested play"));
            render(payload);
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error), "error");
          await refresh(true);
        }
      }

      function stopPolling() {
        if (state.pollTimer !== null) window.clearTimeout(state.pollTimer);
        state.pollTimer = null;
      }

      function schedulePolling() {
        stopPolling();
        if (!state.payload || state.payload.snapshot.status === "finished") return;
        if (!state.connected || !state.hostCapabilities.serverTools) return;
        state.pollTimer = window.setTimeout(async function () {
          await refresh(true);
          schedulePolling();
        }, 1200);
      }

      function applyHostContext(context) {
        state.hostContext = Object.assign({}, state.hostContext, context || {});
        document.documentElement.dataset.theme = state.hostContext.theme === "light" ? "light" : "dark";
        var modes = Array.isArray(state.hostContext.availableDisplayModes) ? state.hostContext.availableDisplayModes : [];
        expandButton.hidden = !modes.includes("fullscreen");
      }

      function sendSize() {
        var width = Math.ceil(window.innerWidth);
        var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
        notify("ui/notifications/size-changed", { width: width, height: height });
      }

      async function connect() {
        try {
          var result = await request("ui/initialize", {
            appInfo: { name: "Waitloop Dou Dizhu", version: "1.0.0" },
            appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
            protocolVersion: PROTOCOL_VERSION
          }, 10000);
          state.hostCapabilities = result && result.hostCapabilities ? result.hostCapabilities : {};
          applyHostContext(result && result.hostContext ? result.hostContext : {});
          state.connected = true;
          notify("ui/notifications/initialized", {});
          sendSize();
          if (state.payload && !state.hostCapabilities.serverTools) {
            showFallback(state.payload, "This Host can display the table but cannot proxy its interactive game tools.");
          } else schedulePolling();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error), "error");
          showFallback(state.payload, "The MCP App handshake failed. Use the web table for Human play, or create_room() for Agent-owned play.");
        }
      }

      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return;
        var incoming = event.data;
        if (!incoming || incoming.jsonrpc !== "2.0") return;

        if (Object.prototype.hasOwnProperty.call(incoming, "id") && (Object.prototype.hasOwnProperty.call(incoming, "result") || incoming.error)) {
          var waiter = pending.get(String(incoming.id));
          if (!waiter) return;
          pending.delete(String(incoming.id));
          if (incoming.error) waiter.reject(new Error(incoming.error.message || "MCP App request failed."));
          else waiter.resolve(incoming.result);
          return;
        }

        if (incoming.method === "ui/notifications/tool-result") {
          var payload = payloadFromResult(incoming.params || {});
          if (payload) render(payload);
          else setMessage("The Host did not forward a readable Waitloop tool result.", "error");
          return;
        }
        if (incoming.method === "ui/notifications/host-context-changed") {
          applyHostContext(incoming.params || {});
          return;
        }
        if (incoming.method === "ui/resource-teardown" && Object.prototype.hasOwnProperty.call(incoming, "id")) {
          stopPolling();
          send({ jsonrpc: "2.0", id: incoming.id, result: {} });
        }
      });

      playButton.addEventListener("click", function () { void playSelected(); });
      passButton.addEventListener("click", function () { void passTurn(); });
      hintButton.addEventListener("click", function () { void hint(); });
      clearButton.addEventListener("click", function () {
        state.selected.clear();
        if (state.payload) render(state.payload);
      });
      refreshButton.addEventListener("click", function () { void refresh(false); });
      expandButton.addEventListener("click", async function () {
        try { await request("ui/request-display-mode", { mode: "fullscreen" }, 10000); }
        catch (error) { setMessage(error instanceof Error ? error.message : String(error), "warning"); }
      });
      openWebButton.addEventListener("click", async function () {
        try { await request("ui/open-link", { url: state.fallbackUrl }, 10000); }
        catch (_error) { fallbackUrl.textContent = state.fallbackUrl; }
      });

      if (typeof ResizeObserver === "function") {
        var resizeScheduled = false;
        new ResizeObserver(function () {
          if (resizeScheduled || !state.connected) return;
          resizeScheduled = true;
          window.requestAnimationFrame(function () {
            resizeScheduled = false;
            sendSize();
          });
        }).observe(document.documentElement);
      }

      window.setTimeout(function () {
        if (!state.payload) showFallback(null, "No game result arrived. Ask the Agent to call open_game() again, or open the separate web table.");
      }, 10000);

      void connect();
    })();
  </script>
</body>
</html>`;
