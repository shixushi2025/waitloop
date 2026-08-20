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

const cliPackage = json("packages/cli/package.json");
const manifest = json("apps/web/public/agent.json");
const agentGuide = read("apps/web/public/agent.md");
const llms = read("apps/web/public/llms.txt");
const skill = read("apps/web/public/skills/waitloop/SKILL.md");
const rootReadme = read("README.md");
const docsIndex = read("docs/README.md");

if (cliPackage.name !== "@waitloop/cli") fail("unexpected CLI package name");
if (manifest.cli?.packageName !== cliPackage.name) fail("agent.json CLI package name is out of sync");

const packageVersion = cliPackage.version;
const publishedVersion = manifest.cli?.version;
const candidateVersion = manifest.cli?.candidateVersion;
if (publishedVersion !== packageVersion && candidateVersion !== packageVersion) {
  fail("agent.json must expose package.json version as either the published version or candidateVersion");
}

const prerelease = String(packageVersion).match(/-([0-9A-Za-z-]+)/)?.[1];
const expectedTag = prerelease ? prerelease.split(".")[0] : "latest";
if (manifest.cli?.distTag !== expectedTag) fail("agent.json CLI distTag is out of sync");
if (manifest.cli?.installCommand !== `npm install -g ${cliPackage.name}@${expectedTag}`) fail("agent.json CLI installCommand is out of sync");
if (manifest.cli?.joinCommand !== "waitloop join <join-code>") fail("agent.json joinCommand is missing or changed unexpectedly");
if (manifest.mcp?.endpoint !== "https://waitloop.run/mcp") fail("agent.json MCP endpoint is out of sync");
if (manifest.mcp?.joinUrlPattern !== "https://waitloop.run/join/<join-code>") fail("agent.json joinUrlPattern is out of sync");

for (const needle of [
  "https://waitloop.run/agent.json",
  "npm install -g @waitloop/cli@alpha",
  "waitloop join",
  "https://waitloop.run/join/<join-code>",
  "https://waitloop.run/mcp",
  "get_turn()",
  "play_move(expectedRevision, moveId)",
]) requireText("agent.md", agentGuide, needle);

for (const needle of [
  "npm install -g @waitloop/cli@alpha",
  "waitloop join",
  "https://waitloop.run/join/<join-code>",
  "https://waitloop.run/mcp",
  "get_turn()",
  "play_move(expectedRevision, moveId)",
]) requireText("SKILL.md", skill, needle);

for (const needle of [
  "https://waitloop.run/agent.md",
  "https://waitloop.run/agent.json",
  "https://waitloop.run/skills/waitloop/SKILL.md",
  "https://waitloop.run/join/<join-code>",
  "https://waitloop.run/mcp",
  "npm install -g @waitloop/cli@alpha",
]) requireText("llms.txt", llms, needle);

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

console.log(`Repository contract passed: ${canonicalDocs.length} canonical docs indexed; Agent/CLI/MCP surfaces synchronized.`);
