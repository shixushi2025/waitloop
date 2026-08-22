import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(root, "packages/cli/package.json");
const manifestPath = resolve(root, "apps/web/public/agent.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const agentManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  throw new Error(`CLI package validation failed: ${message}`);
}

function distTagForVersion(version) {
  const prerelease = String(version).match(/-([0-9A-Za-z-]+)/)?.[1];
  return prerelease ? prerelease.split(".")[0] : "latest";
}

if (packageJson.name !== "@waitloop/cli") fail("unexpected package name");
if (typeof packageJson.version !== "string" || !VERSION_PATTERN.test(packageJson.version)) {
  fail("package version is not a valid release version");
}
if (packageJson.publishConfig?.access !== "public") fail("publishConfig.access must be public");
if (packageJson.publishConfig?.registry !== "https://registry.npmjs.org/") fail("publishConfig.registry must be npmjs");
if (packageJson.repository?.url !== "git+https://github.com/shixushi2025/waitloop.git") {
  fail("repository.url must use the normalized canonical GitHub repository URL");
}
if (!Array.isArray(packageJson.keywords) || !packageJson.keywords.includes("mcp-apps")) {
  fail("package keywords must advertise MCP Apps support");
}

if (agentManifest.cli?.packageName !== packageJson.name) fail("agent.json CLI packageName is out of sync");
const publishedVersion = agentManifest.cli?.version;
if (typeof publishedVersion !== "string" || !VERSION_PATTERN.test(publishedVersion)) {
  fail("agent.json published CLI version is invalid");
}
if (agentManifest.cli?.published !== true) fail("agent.json cli.version must describe a published version");

const candidateVersion = agentManifest.cli?.candidateVersion;
if (packageJson.version === publishedVersion) {
  if (candidateVersion !== undefined) fail("published CLI state must not retain candidateVersion");
  if (agentManifest.cli?.candidatePublished !== undefined) fail("published CLI state must not retain candidatePublished");
} else {
  if (candidateVersion !== packageJson.version) {
    fail("source-ahead CLI state must expose package.json version as candidateVersion");
  }
  if (agentManifest.cli?.candidatePublished !== false) {
    fail("source-ahead CLI candidate must set candidatePublished:false");
  }
}

const expectedDistTag = distTagForVersion(publishedVersion);
if (agentManifest.cli?.distTag !== expectedDistTag) {
  fail("agent.json CLI distTag must follow the published version, not the package/source candidate");
}
if (agentManifest.cli?.installCommand !== `npm install -g ${packageJson.name}@${expectedDistTag}`) {
  fail("agent.json CLI installCommand must follow the published channel");
}
if (agentManifest.mcpApps?.resourceUri !== "ui://waitloop/doudizhu/v1") fail("agent.json MCP App resource is missing");
if (agentManifest.mcpApps?.mimeType !== "text/html;profile=mcp-app") fail("agent.json MCP App MIME type is missing");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packOutput = execFileSync(
  npm,
  ["pack", "--dry-run", "--json", "./packages/cli"],
  { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);

const packed = JSON.parse(packOutput);
if (!Array.isArray(packed) || packed.length !== 1 || !Array.isArray(packed[0]?.files)) {
  fail("npm pack returned an unexpected manifest");
}

const files = new Set(packed[0].files.map((file) => file.path));
for (const required of [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.js",
  "dist/mcp-bridge.js",
  "dist/mcp-app.js",
  "dist/human-room-client.js",
]) {
  if (!files.has(required)) fail(`packed tarball is missing ${required}`);
}
for (const path of files) {
  if (path.startsWith("src/") || path.includes(".waitloop") || path.includes("config.json")) {
    fail(`unexpected file in package: ${path}`);
  }
}

const builtIndex = resolve(root, "packages/cli/dist/index.js");
const builtSource = readFileSync(builtIndex, "utf8");
if (!builtSource.startsWith("#!/usr/bin/env node")) fail("dist/index.js is missing its executable shebang");

const builtApp = readFileSync(resolve(root, "packages/cli/dist/mcp-app.js"), "utf8");
for (const needle of [
  "ui://waitloop/doudizhu/v1",
  "text/html;profile=mcp-app",
  "ui/initialize",
  "waitloop/uiToken",
  "ui_play_cards",
]) {
  if (!builtApp.includes(needle)) fail(`built MCP App is missing ${needle}`);
}
if (/wlui_[a-f0-9]{64}/.test(builtApp)) fail("built MCP App contains a concrete UI capability");
if (builtApp.includes("wlview_") || builtApp.includes("wlseat_") || builtApp.includes("wla_")) {
  fail("built MCP App contains a Room credential prefix");
}

const versionOutput = execFileSync(process.execPath, [builtIndex, "--version"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (versionOutput !== packageJson.version) {
  fail(`waitloop --version returned ${versionOutput}; expected source/package version ${packageJson.version}`);
}

const helpRoot = mkdtempSync(resolve(tmpdir(), "waitloop-help-"));
const helpHookPath = resolve(helpRoot, "hooks.json");
try {
  const helpOutput = execFileSync(process.execPath, [builtIndex, "install", "codex", "--help"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WAITLOOP_CODEX_HOOKS: helpHookPath },
  });
  if (!helpOutput.includes("Usage:")) fail("nested --help did not print CLI help");
  if (existsSync(helpHookPath)) fail("waitloop install codex --help created a hooks file");
} finally {
  rmSync(helpRoot, { recursive: true, force: true });
}

console.log(`@waitloop/cli@${packageJson.version} source package validation passed (${files.size} files, published=${publishedVersion}, MCP App included).`);
