import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type AgentId = "claude-code" | "codex" | "cursor" | "dsh";

export interface AgentDetection {
  id: AgentId;
  label: string;
  installed: boolean;
  detail: string;
  integration: "available" | "planned";
}

function executableExtensions(): string[] {
  if (process.platform !== "win32") return [""];
  const raw = process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM";
  return raw.split(";").filter(Boolean);
}

function executableOnPath(command: string): string | null {
  const pathValue = process.env.PATH || "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const extension of executableExtensions()) {
      const candidate = join(directory, process.platform === "win32" ? `${command}${extension}` : command);
      try {
        accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Keep searching the PATH.
      }
    }
  }
  return null;
}

function cursorAppPath(): string | null {
  const home = homedir();
  const candidates = process.platform === "darwin"
    ? ["/Applications/Cursor.app", join(home, "Applications", "Cursor.app")]
    : process.platform === "win32"
      ? [
          process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Cursor", "Cursor.exe") : "",
          process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Cursor", "Cursor.exe") : "",
        ]
      : ["/usr/bin/cursor", "/usr/local/bin/cursor", join(home, ".local", "bin", "cursor")];
  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? null;
}

export function detectAgents(): AgentDetection[] {
  const claudePath = executableOnPath("claude");
  const codexPath = executableOnPath("codex");
  const cursorPath = executableOnPath("cursor") ?? cursorAppPath();
  const dshPath = executableOnPath("dsh");

  return [
    {
      id: "claude-code",
      label: "Claude Code",
      installed: claudePath !== null,
      detail: claudePath ?? "not detected",
      integration: "available",
    },
    {
      id: "codex",
      label: "Codex",
      installed: codexPath !== null,
      detail: codexPath ?? "not detected",
      integration: "available",
    },
    {
      id: "cursor",
      label: "Cursor",
      installed: cursorPath !== null,
      detail: cursorPath ?? "not detected",
      integration: "available",
    },
    {
      id: "dsh",
      label: "DSH",
      installed: dshPath !== null,
      detail: dshPath ?? "not detected",
      integration: "planned",
    },
  ];
}
