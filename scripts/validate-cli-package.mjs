import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

if (packageJson.name !== "@waitloop/cli") fail("unexpected package name");
if (typeof packageJson.version !== "string" || !VERSION_PATTERN.test(packageJson.version)) {
  fail("package version is not a valid release version");
}
if (packageJson.publishConfig?.access !== "public") fail("publishConfig.access must be public");
if (packageJson.publishConfig?.registry !== "https://registry.npmjs.org/") fail("publishConfig.registry must be npmjs");
if (packageJson.repository?.url !== "git+https://github.com/shixushi2025/waitloop.git") {
  fail("repository.url must use the normalized canonical GitHub repository URL");
}

const prerelease = packageJson.version.match(/-([0-9A-Za-z-]+)/)?.[1];
const expectedDistTag = prerelease ? prerelease.split(".")[0] : "latest";
if (agentManifest.cli?.packageName !== packageJson.name) fail("agent.json CLI packageName is out of sync");
if (typeof agentManifest.cli?.version !== "string" || !VERSION_PATTERN.test(agentManifest.cli.version)) {
  fail("agent.json published CLI version is invalid");
}
if (agentManifest.cli?.distTag !== expectedDistTag) fail("agent.json CLI distTag is out of sync");
if (agentManifest.cli?.installCommand !== `npm install -g ${packageJson.name}@${expectedDistTag}`) {
  fail("agent.json CLI installCommand is out of sync");
}
if (agentManifest.cli?.published === false && agentManifest.cli.version !== packageJson.version) {
  fail("an unpublished staged manifest must match the package candidate version");
}
if (agentManifest.cli?.candidateVersion !== undefined && agentManifest.cli.candidateVersion !== packageJson.version) {
  fail("agent.json candidateVersion is out of sync with package.json");
}

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
for (const required of ["package.json", "README.md", "LICENSE", "dist/index.js"]) {
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

const versionOutput = execFileSync(process.execPath, [builtIndex, "--version"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (versionOutput !== packageJson.version) {
  fail(`waitloop --version returned ${versionOutput}; expected ${packageJson.version}`);
}

console.log(`@waitloop/cli@${packageJson.version} package validation passed (${files.size} files).`);
