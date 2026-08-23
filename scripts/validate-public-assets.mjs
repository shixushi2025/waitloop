import { readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "apps/web/public");

function fail(message) {
  throw new Error(`Public asset validation failed: ${message}`);
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

const forbidden = [];
for (const absolute of filesUnder(publicRoot)) {
  const path = relative(root, absolute).split(sep).join("/");
  const basename = path.split("/").at(-1) ?? path;
  if (
    path.includes("/__tests__/") ||
    /\.(?:test|spec|fixture)\.[^.]+$/i.test(basename) ||
    /\.(?:ts|tsx)$/i.test(basename)
  ) {
    forbidden.push(path);
  }
}

if (forbidden.length > 0) {
  fail(`non-deployable source/test files are present under apps/web/public:\n${forbidden.map((path) => `- ${path}`).join("\n")}`);
}

console.log("Public asset validation passed.");
