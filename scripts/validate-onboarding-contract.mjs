import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const manifest = JSON.parse(read("apps/web/public/agent.json"));

function fail(message) {
  throw new Error(`Onboarding contract validation failed: ${message}`);
}

function requireText(path, needle) {
  if (!read(path).includes(needle)) fail(`${path} must contain ${JSON.stringify(needle)}`);
}

function requireArrayValue(path, values, value) {
  if (!Array.isArray(values) || !values.includes(value)) fail(`${path} must include ${JSON.stringify(value)}`);
}

for (const mirror of [
  "https://raw.githubusercontent.com/shixushi2025/waitloop/main/apps/web/public/agent.md",
  "https://github.com/shixushi2025/waitloop/blob/main/apps/web/public/agent.md",
]) requireArrayValue("agent.json guideMirrors", manifest.guideMirrors, mirror);

if (typeof manifest.cli?.doctorBehavior !== "string" || !manifest.cli.doctorBehavior.includes("Codex")) {
  fail("agent.json cli.doctorBehavior must describe current CLI/Codex diagnostics");
}
for (const key of ["joinBehavior", "continuationBehavior"]) {
  if (typeof manifest.mcp?.[key] !== "string" || manifest.mcp[key].length === 0) fail(`agent.json mcp.${key} is required`);
}

for (const needle of [
  "https://raw.githubusercontent.com/shixushi2025/waitloop/main/apps/web/public/agent.md",
  "waitloop doctor",
  "does **not** mean the currently running",
  "MCP is request/response participation",
  "Plugin packaging",
]) requireText("apps/web/public/agent.md", needle);

for (const needle of [
  "waitloop doctor",
  "Join is credential claim/cache",
  "MCP does not wake an Agent",
  "Plugin",
]) requireText("apps/web/public/skills/waitloop/SKILL.md", needle);

for (const needle of [
  "https://raw.githubusercontent.com/shixushi2025/waitloop/main/apps/web/public/agent.md",
  "waitloop doctor",
  "Join success is not MCP connection",
  "MCP does not wake an Agent",
]) requireText("apps/web/public/llms.txt", needle);

for (const [path, needles] of [
  ["docs/cli.md", ["Join is not MCP attachment", "waitloop doctor", "Codex Plugin"]],
  ["docs/status.md", ["GitHub mirrors", "Join success", "MCP is request/response participation"]],
  ["docs/roadmap.md", ["stabilization before feature expansion", "Current-flow stabilization"]],
]) {
  for (const needle of needles) requireText(path, needle);
}

console.log("Onboarding contract passed: discovery fallbacks, CLI diagnostics, Join semantics, and continuous-play guidance are synchronized.");
