import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configuredEntry = process.env.WAITLOOP_CLI_ENTRY;
const cli = configuredEntry
  ? (isAbsolute(configuredEntry) ? configuredEntry : resolve(root, configuredEntry))
  : resolve(root, "packages/cli/dist/index.js");
await access(cli);

const stateRoot = await mkdtemp(join(tmpdir(), "waitloop-mcp-wire-"));
const child = spawn(process.execPath, [cli, "mcp"], {
  cwd: root,
  env: {
    ...process.env,
    WAITLOOP_JOIN_DIR: join(stateRoot, "joins"),
    WAITLOOP_APP_ROOM_DIR: join(stateRoot, "app-rooms"),
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

const pending = new Map();
let buffer = "";
let protocolFailure = null;

function fail(message, cause) {
  if (protocolFailure) return;
  protocolFailure = new Error(message, cause ? { cause } : undefined);
  for (const waiter of pending.values()) waiter.reject(protocolFailure);
  pending.clear();
  try { child.kill(); } catch {}
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      fail(`invalid JSON from stdio server: ${line}`, error);
      return;
    }
    const waiter = pending.get(String(message.id));
    if (waiter) {
      pending.delete(String(message.id));
      waiter.resolve(message);
    }
  }
});
child.once("error", (error) => fail("could not start MCP stdio server", error));

let nextId = 1;
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolveRequest, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`timeout waiting for ${method}; stderr=${stderr}`));
    }, 5_000);
    pending.set(String(id), {
      resolve(message) {
        clearTimeout(timeout);
        resolveRequest(message);
      },
      reject(error) {
        clearTimeout(timeout);
        reject(error);
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notification(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {
      extensions: {
        "io.modelcontextprotocol/ui": {
          mimeTypes: ["text/html;profile=mcp-app"],
        },
      },
    },
    clientInfo: { name: "waitloop-ci", version: "1.0.0" },
  });
  assert(!initialized.error, `initialize failed: ${JSON.stringify(initialized.error)}`);
  assert(initialized.result?.serverInfo?.name === "waitloop-local", "unexpected MCP server name");
  notification("notifications/initialized");

  const listed = await request("tools/list");
  assert(!listed.error, `tools/list failed: ${JSON.stringify(listed.error)}`);
  const tools = listed.result?.tools;
  const names = tools?.map((tool) => tool.name);
  assert(Array.isArray(names), "tools/list did not return tools");
  for (const required of [
    "open_game",
    "create_room",
    "join_room",
    "get_active_room",
    "wait_for_turn",
    "wait_for_room_update",
    "play_move",
    "take_control",
    "ui_get_game",
    "ui_play_cards",
    "ui_pass",
    "ui_hint",
  ]) {
    assert(names.includes(required), `tools/list is missing ${required}`);
  }

  const openGame = tools.find((tool) => tool.name === "open_game");
  assert(openGame?._meta?.ui?.resourceUri === "ui://waitloop/doudizhu/v1", "open_game is missing modern MCP App metadata");
  assert(openGame?._meta?.["ui/resourceUri"] === "ui://waitloop/doudizhu/v1", "open_game is missing legacy MCP App metadata");
  assert(openGame?._meta?.ui?.visibility?.includes("model"), "open_game must remain model-visible");
  assert(!openGame?.inputSchema?.properties?.uiToken, "open_game must not accept a model-visible Human UI capability");

  for (const name of ["ui_get_game", "ui_play_cards", "ui_pass", "ui_hint"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert(JSON.stringify(tool?._meta?.ui?.visibility) === JSON.stringify(["app"]), `${name} must be app-only`);
    assert(tool?.inputSchema?.properties?.uiToken?.pattern === "^wlui_[a-f0-9]{64}$", `${name} must require the private UI capability`);
    assert(tool?.inputSchema?.required?.includes("uiToken"), `${name} must require uiToken`);
  }

  const resources = await request("resources/list");
  assert(!resources.error, `resources/list failed: ${JSON.stringify(resources.error)}`);
  const gameResource = resources.result?.resources?.find((resource) => resource.uri === "ui://waitloop/doudizhu/v1");
  assert(gameResource, "resources/list is missing the Waitloop game MCP App");
  assert(gameResource.mimeType === "text/html;profile=mcp-app", "MCP App resource has the wrong MIME type");

  const read = await request("resources/read", { uri: "ui://waitloop/doudizhu/v1" });
  assert(!read.error, `resources/read failed: ${JSON.stringify(read.error)}`);
  const appContent = read.result?.contents?.[0];
  assert(appContent?.mimeType === "text/html;profile=mcp-app", "MCP App content has the wrong MIME type");
  assert(typeof appContent?.text === "string" && appContent.text.includes("ui/initialize"), "MCP App HTML is missing the UI handshake");
  assert(appContent.text.includes("ui/notifications/tool-result"), "MCP App HTML is missing tool-result delivery");
  assert(appContent.text.includes("waitloop/uiToken"), "MCP App HTML is missing UI capability handling");
  assert(appContent.text.includes("ui_play_cards"), "MCP App HTML is missing Human play controls");
  assert(!appContent.text.includes("wlseat_"), "MCP App HTML leaked an Agent credential prefix");
  assert(!appContent.text.includes("wlview_"), "MCP App HTML leaked a viewer credential prefix");
  assert(!/wlui_[a-f0-9]{64}/.test(appContent.text), "MCP App HTML leaked a concrete UI capability");

  const active = await request("tools/call", {
    name: "get_active_room",
    arguments: {},
  });
  assert(!active.error, `get_active_room transport failed: ${JSON.stringify(active.error)}`);
  const payload = JSON.parse(active.result?.content?.[0]?.text ?? "null");
  assert(payload?.active === false, "clean bridge should report no active Agent Room");

  const unauthorized = await request("tools/call", {
    name: "ui_get_game",
    arguments: {
      roomId: "room-not-local",
      uiToken: `wlui_${"0".repeat(64)}`,
    },
  });
  assert(!unauthorized.error, `ui_get_game transport failed unexpectedly: ${JSON.stringify(unauthorized.error)}`);
  assert(unauthorized.result?.isError === true, "unknown Human Room must be a tool error");
  const unauthorizedText = unauthorized.result?.content?.[0]?.text ?? "";
  assert(!unauthorizedText.includes("wlui_"), "Human UI capability leaked through an error");

  console.log(`MCP stdio validation passed (${names.length} tools, 1 MCP App resource) using ${cli}.`);
} finally {
  child.stdin.end();
  const timer = setTimeout(() => {
    try { child.kill(); } catch {}
  }, 1_000);
  await exited;
  clearTimeout(timer);
  await rm(stateRoot, { recursive: true, force: true });
}
