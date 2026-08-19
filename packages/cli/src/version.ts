import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageMetadata {
  version?: unknown;
}

export function getCliVersion(): string {
  try {
    const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as PackageMetadata;
    if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
  } catch {
    // Keep the CLI usable from unusual development layouts even if package metadata cannot be read.
  }
  return "0.0.0-dev";
}
