import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

function fail(message) {
  throw new Error(`Repository contract validation failed: ${message}`);
}

function requireText(path, content, needle) {
  if (!content.includes(needle)) fail(`${path} must contain ${JSON.stringify(needle)}`);
}

function requireIncludes(path, values, required) {
  if (!Array.isArray(values) || !values.includes(required)) fail(`${path} must include ${JSON.stringify(required)}`);
}

function requireString(path, value) {
  if (typeof value !== "string" || value.length === 0) fail(`${path} is required`);
}

const cliPackage = json("packages/cli/package.json");
const manifest = json("apps/web/public/agent.json");
const agentGuide = read("apps/web/public/agent.md");
const llms = read("apps/web/public/llms.txt");
const skill = read("apps/web/public/skills/waitloop/SKILL.md");
const rootReadme = read("README.md");
const agents = read("AGENTS.md");
const docsIndex = read("docs/README.md");

if (cliPackage.name !== "@waitloop/cli") fail("unexpected CLI package name");
if (manifest.cli?.packageName !== cliPackage.name) fail("agent.json CLI package name is out of sync");

const packageVersion = cliPackage.version;
const publishedVersion = manifest.cli?.version;
const candidateVersion = manifest.cli?.candidateVersion;
if (publishedVersion !== packageVersion && candidateVersion !== packageVersion) {
  fail("agent.json must expose package.json version as either the published version or candidateVersion");
}
if (candidateVersion === packageVersion && manifest.cli?.candidatePublished !== false) {
  fail("an unpublished candidate matching package.json must set candidatePublished:false");
}

const prerelease = String(packageVersion).match(/-([0-9A-Za-z-]+)/)?.[1];
const expectedTag = prerelease ? prerelease.split(".")[0] : "latest";
if (manifest.cli?.distTag !== expectedTag) fail("agent.json CLI distTag is out of sync");
if (manifest.cli?.installCommand !== `npm install -g ${cliPackage.name}@${expectedTag}`) fail("agent.json CLI installCommand is out of sync");
if (manifest.cli?.joinCommand !== "waitloop join <join-code>") fail("agent.json joinCommand is missing or changed unexpectedly");
if (manifest.cli?.roomCreateCommand !== "waitloop room create") fail("agent.json roomCreateCommand is out of sync");
if (manifest.cli?.localMcpCommand !== "waitloop mcp") fail("agent.json localMcpCommand is out of sync");
if (manifest.rooms?.createEndpoint !== "https://waitloop.run/api/v1/rooms") fail("agent.json Room API endpoint is out of sync");
if (manifest.mcp?.endpoint !== "https://waitloop.run/mcp") fail("agent.json remote MCP endpoint is out of sync");
if (manifest.mcp?.joinUrlPattern !== "https://waitloop.run/join/<join-code>") fail("agent.json joinUrlPattern is out of sync");
if (manifest.localMcp?.status !== "available") fail("agent.json local MCP must be available");
if (manifest.localMcp?.transport !== "stdio" || manifest.localMcp?.command !== "waitloop mcp") {
  fail("agent.json local MCP transport/command is out of sync");
}

const remoteTools = ["get_turn", "wait_for_turn", "play_move", "comment", "yield_to_bot", "take_control"];
for (const tool of remoteTools) requireIncludes("agent.json mcp.tools", manifest.mcp?.tools, tool);

const localTools = ["open_game", "create_room", "join_room", "get_active_room", "leave_room", ...remoteTools];
for (const tool of localTools) requireIncludes("agent.json localMcp.tools", manifest.localMcp?.tools, tool);

const appTools = ["ui_get_game", "ui_play_cards", "ui_pass", "ui_hint"];
for (const tool of appTools) requireIncludes("agent.json localMcp.appTools", manifest.localMcp?.appTools, tool);

if (manifest.mcpApps?.protocolVersion !== "2026-01-26") fail("agent.json MCP Apps protocol version is out of sync");
if (manifest.mcpApps?.resourceUri !== "ui://waitloop/doudizhu/v1") fail("agent.json MCP App resource URI is out of sync");
if (manifest.mcpApps?.mimeType !== "text/html;profile=mcp-app") fail("agent.json MCP App MIME type is out of sync");
if (manifest.mcpApps?.triggerTool !== "open_game") fail("agent.json MCP App trigger tool is out of sync");
if (manifest.mcpApps?.sameRoomFallback !== false) fail("agent.json must not claim the standalone fallback resumes the private inline Room");
for (const key of ["hostRequirement", "hostFallback", "privacy", "network"]) requireString(`agent.json mcpApps.${key}`, manifest.mcpApps?.[key]);
if (!String(manifest.mcpApps?.privacy).includes("_meta")) fail("agent.json MCP App privacy must describe result _meta capability delivery");
if (!String(manifest.mcpApps?.privacy).includes("model-visible")) fail("agent.json MCP App privacy must describe model visibility boundary");

for (const mode of ["bots", "hosted-agent", "connected-agent", "companion-agent", "agent-bots"]) {
  requireIncludes("agent.json rooms.modes", manifest.rooms?.modes, mode);
}
if (manifest.rooms?.headlessAgentMode !== "agent-bots") fail("agent.json headlessAgentMode is out of sync");
if (manifest.rooms?.companionMode !== "companion-agent") fail("agent.json companionMode is out of sync");
for (const key of ["seatIds", "roomLifetime", "joinLifetime", "browserIdentity", "recovery", "inlineHumanMode"]) {
  requireString(`agent.json rooms.${key}`, manifest.rooms?.[key]);
}

for (const needle of [
  "https://waitloop.run/agent.json",
  "https://waitloop.run/api/v1/rooms",
  "npm install -g @waitloop/cli@alpha",
  "waitloop mcp",
  "waitloop join",
  "https://waitloop.run/mcp",
  "open_game",
  "create_room()",
  "join_room",
  "get_active_room()",
  "leave_room()",
  "get_turn()",
  "wait_for_turn",
  "play_move(expectedRevision, moveId)",
  "comment(text)",
  "yield_to_bot()",
  "take_control()",
  "ui_get_game",
  "ui_play_cards",
  "ui_pass",
  "ui_hint",
  "ui://waitloop/doudizhu/v1",
  "text/html;profile=mcp-app",
  "MCP Apps-capable Host",
  "separate",
  "wlui_",
  "_meta",
  "seat-1",
  "Actor ID is not a credential",
  "companion-agent",
  "agent-bots",
  "Advisor",
]) requireText("agent.md", agentGuide, needle);

for (const needle of [
  "npm install -g @waitloop/cli@alpha",
  "waitloop mcp",
  "waitloop doctor",
  "open_game",
  "create_room()",
  "join_room",
  "get_active_room()",
  "leave_room()",
  "get_turn()",
  "wait_for_turn",
  "play_move(expectedRevision, moveId)",
  "comment(text)",
  "yield_to_bot()",
  "take_control()",
  "ui_get_game",
  "ui_play_cards",
  "ui://waitloop/doudizhu/v1",
  "MCP Apps-capable Host",
  "separate",
  "wlui_",
  "_meta",
  "seat-1",
  "Advisor",
]) requireText("SKILL.md", skill, needle);

for (const needle of [
  "https://waitloop.run/agent.md",
  "https://waitloop.run/agent.json",
  "https://waitloop.run/skills/waitloop/SKILL.md",
  "https://waitloop.run/api/v1/rooms",
  "https://waitloop.run/join/<join-code>",
  "https://waitloop.run/mcp",
  "npm install -g @waitloop/cli@alpha",
  "waitloop mcp",
  "open_game",
  "create_room()",
  "join_room",
  "wait_for_turn",
  "yield_to_bot()",
  "take_control()",
  "ui://waitloop/doudizhu/v1",
  "text/html;profile=mcp-app",
  "MCP Apps-capable Host",
  "wlui_",
  "_meta",
]) requireText("llms.txt", llms, needle);

for (const needle of [
  "Seat",
  "Actor",
  "Controller",
  "seat-1",
  "waitloop mcp",
  "wait_for_turn",
  "yield_to_bot()",
  "take_control()",
  "credential",
  "open_game",
  "ui://waitloop/doudizhu/v1",
  "MCP App",
  "wlui_",
]) {
  requireText("README.md", rootReadme, needle);
  requireText("AGENTS.md", agents, needle);
}

if (!rootReadme.includes("docs/README.md")) fail("root README must point to the canonical docs index");
if (rootReadme.includes("docs/game-experience-v2.md")) fail("root README references removed transitional documentation");

const docsDir = resolve(root, "docs");
const canonicalDocs = readdirSync(docsDir).filter((name) => name.endsWith(".md") && name !== "README.md").sort();
for (const name of canonicalDocs) {
  if (!docsIndex.includes(`](${name})`)) fail(`docs/README.md does not index ${name}`);
}

const markdownFiles = [
  "README.md",
  "AGENTS.md",
  ...canonicalDocs.map((name) => `docs/${name}`),
  "docs/README.md",
  "packages/cli/README.md",
  "apps/web/public/agent.md",
  "apps/web/public/skills/waitloop/SKILL.md",
];
for (const path of markdownFiles) {
  const content = read(path);
  if (content.includes("game-experience-v2.md")) fail(`${path} references superseded transitional documentation`);
}

const stableInstallDocs = [
  "README.md",
  "docs/cli.md",
  "packages/cli/README.md",
  "apps/web/public/agent.md",
  "apps/web/public/skills/waitloop/SKILL.md",
];
const exactVersionPattern = /@waitloop\/cli@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
for (const path of stableInstallDocs) {
  if (exactVersionPattern.test(read(path))) fail(`${path} hard-codes an exact CLI release; use @waitloop/cli@alpha`);
}

for (const path of ["docs/game-system.md", "docs/mcp.md", "docs/protocol.md", "docs/security.md", "docs/architecture.md", "docs/status.md"]) {
  const content = read(path);
  for (const needle of ["Seat", "Actor", "credential", "seat-1", "wait_for_turn", "waitloop mcp"]) requireText(path, content, needle);
}
for (const path of ["docs/game-system.md", "docs/mcp.md", "docs/protocol.md", "docs/security.md", "docs/status.md"]) {
  const content = read(path);
  for (const needle of ["yield_to_bot", "take_control"]) requireText(path, content, needle);
}
for (const path of ["docs/mcp.md", "docs/protocol.md", "docs/security.md", "docs/architecture.md", "docs/status.md"]) {
  const content = read(path);
  for (const needle of ["open_game", "MCP App", "ui://waitloop/doudizhu/v1", "wlui_", "_meta"]) requireText(path, content, needle);
}

console.log(`Repository contract passed: ${canonicalDocs.length} canonical docs indexed; CLI/Room/Agent MCP/Human MCP App/wait/recovery surfaces synchronized.`);
