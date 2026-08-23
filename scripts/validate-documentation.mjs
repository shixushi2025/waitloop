import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`Documentation validation failed: ${message}`);
}

function filesUnder(directory) {
  const result = [];
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) result.push(...filesUnder(absolute));
    else result.push(absolute);
  }
  return result;
}

const explicitFiles = [
  "README.md",
  "AGENTS.md",
  "packages/cli/README.md",
  "apps/web/public/agent.md",
  "apps/web/public/llms.txt",
  "apps/web/public/skills/waitloop/SKILL.md",
];
const documentationFiles = [
  ...explicitFiles.map((path) => resolve(root, path)),
  ...filesUnder(resolve(root, "docs")).filter((path) => path.endsWith(".md")),
];

const exactTestCount = /\b(?:more than\s+)?\d+\+?\s+(?:unit\/regression\s+)?tests?\b/i;
const forbiddenLegacyPhrases = [
  "The Human MCP App refreshes through app-only `ui_get_game` at about 1.2 seconds while active.",
];

for (const absolute of documentationFiles) {
  const path = relative(root, absolute).split(sep).join("/");
  const content = readFileSync(absolute, "utf8");

  if (exactTestCount.test(content)) {
    fail(`${path} contains an exact test count; describe the suite by coverage instead`);
  }
  for (const phrase of forbiddenLegacyPhrases) {
    if (content.includes(phrase)) fail(`${path} contains obsolete behavior: ${JSON.stringify(phrase)}`);
  }

  const headings = new Map();
  let fence = null;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const level = heading[1].length;
    const title = heading[2].replace(/[`*_]/g, "").trim().toLowerCase();
    const key = `${level}:${title}`;
    const previous = headings.get(key);
    if (previous !== undefined) {
      fail(`${path} repeats heading ${JSON.stringify(heading[2])} on lines ${previous} and ${index + 1}`);
    }
    headings.set(key, index + 1);
  }
}

console.log("Documentation validation passed.");
