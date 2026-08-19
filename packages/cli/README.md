# @waitloop/cli

Waitloop CLI connects local coding agents to [waitloop.run](https://waitloop.run) without sending prompts, source code, repository contents, tool payloads, or terminal output.

## Install

```bash
npm install -g @waitloop/cli@alpha
```

Then initialize and pair this machine:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

`waitloop pair` creates a short-lived pairing request and normally opens a browser approval page. The resulting device credential is stored locally and is scoped to lifecycle reporting.

## Coding-agent integrations

Install only the integrations you actually use:

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

Or install all currently supported detected integrations:

```bash
waitloop install all
```

Codex users must review/trust the Waitloop hook in Codex's `/hooks` UI after installation.

Remove only Waitloop-owned hooks with:

```bash
waitloop uninstall claude-code
waitloop uninstall cursor
waitloop uninstall codex
waitloop uninstall all
```

## Commands

```text
waitloop init
waitloop pair
waitloop unpair
waitloop doctor
waitloop install <claude-code|cursor|codex|all>
waitloop uninstall <claude-code|cursor|codex|all>
waitloop status
waitloop open [--print]
waitloop config
```

## Agent-facing documentation

Give an AI agent this canonical URL:

```text
https://waitloop.run/agent.md
```

Machine-readable manifest:

```text
https://waitloop.run/agent.json
```

Skill:

```text
https://waitloop.run/skills/waitloop/SKILL.md
```

Game MCP is room-scoped and temporary. Do not configure `https://waitloop.run/mcp` globally without a specific room ID and `wlseat_...` seat credential.

## Privacy

Lifecycle events contain only minimal Waitloop metadata: event ID, opaque Waitloop session ID, agent kind, lifecycle state, and timestamp. Native agent session IDs are used only for local correlation and are not emitted to Waitloop.

See the repository for the complete protocol and security design:

https://github.com/shixushi2025/waitloop

## License

MIT
