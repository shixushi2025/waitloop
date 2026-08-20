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

const joinRoot = await mkdtemp(join(tmpdir(), "waitloop-mcp-wire-"));
const child = spawn(process.execPath, [cli, "mcp"], {
  cwd: root,
  env: {
    ...process.env,
    WAITLOOP_JOIN_DIR: joinRoot,
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
    capabilities: {},
    clientInfo: { name: "waitloop-ci", version: "1.0.0" },
  });
  assert(!initialized.error, `initialize failed: ${JSON.stringify(initialized.error)}`);
  assert(initialized.result?.serverInfo?.name === "waitloop-local", "unexpected MCP server name");
  notification("notifications/initialized");

  const listed = await request("tools/list");
  assert(!listed.error, `tools/list failed: ${JSON.stringify(listed.error)}`);
  const names = listed.result?.tools?.map((tool) => tool.name);
  assert(Array.isArray(names), "tools/list did not return tools");
  for (const required of ["create_room", "join_room", "get_active_room", "wait_for_turn", "play_move", "take_control"]) {
    assert(names.includes(required), `tools/list is missing ${required}`);
  }

  const active = await request("tools/call", {
    name: "get_active_room",
    arguments: {},
  });
  assert(!active.error, `get_active_room transport failed: ${JSON.stringify(active.error)}`);
  const payload = JSON.parse(active.result?.content?.[0]?.text ?? "null");
  assert(payload?.active === false, "clean bridge should report no active Room");

  console.log(`MCP stdio validation passed (${names.length} tools) using ${cli}.`);
} finally {
  child.stdin.end();
  const timer = setTimeout(() => {
    try { child.kill(); } catch {}
  }, 1_000);
  await exited;
  clearTimeout(timer);
  await rm(joinRoot, { recursive: true, force: true });
}
