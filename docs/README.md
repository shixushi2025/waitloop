# Waitloop documentation

This directory contains the **current durable documentation** for Waitloop. It is intentionally not a history of every implementation stage.

For a new human or coding agent, use this reading order:

1. [`../README.md`](../README.md) — product/repository entry point.
2. [`status.md`](status.md) — what is implemented now and what is still missing.
3. [`architecture.md`](architecture.md) — runtime boundaries and module responsibilities.
4. Read only the canonical document(s) relevant to the subsystem you are changing.
5. Confirm details against the implementation and tests.

Repository-editing agents must also follow [`../AGENTS.md`](../AGENTS.md).

## Canonical sources

| Topic | Canonical document |
| --- | --- |
| Product intent, user journey, non-goals | [`product.md`](product.md) |
| Current architecture and responsibility boundaries | [`architecture.md`](architecture.md) |
| Wire contracts and public API semantics | [`protocol.md`](protocol.md) |
| Security, privacy, credentials, trust boundaries | [`security.md`](security.md) |
| Generic game runtime, room phases, human/agent projections | [`game-system.md`](game-system.md) |
| Current Dou Dizhu rules | [`doudizhu-rules.md`](doudizhu-rules.md) |
| Connected-agent join and MCP seat behavior | [`mcp.md`](mcp.md) |
| CLI, lifecycle adapters, join command | [`cli.md`](cli.md) |
| Device/browser pairing | [`pairing.md`](pairing.md) |
| Hosted model players | [`hosted-agents.md`](hosted-agents.md) |
| Visual and interaction language | [`design.md`](design.md) |
| CLI release procedure | [`cli-release.md`](cli-release.md) |
| Current implemented state and known gaps | [`status.md`](status.md) |
| Forward-looking priorities only | [`roadmap.md`](roadmap.md) |

## Product-facing Agent surfaces

These are public product interfaces and must stay synchronized with the code and the canonical docs above:

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

Their repository sources are under `apps/web/public/` plus the Worker MCP/join implementation and `packages/cli`.

## Documentation lifecycle

### Main contains current truth

A document on `main` should help someone understand or operate the **current system**. It should not require the reader to know which implementation phase came before or after it.

When a feature changes, update its canonical document in the same change as the code. Documentation drift is a bug.

### Temporary design work does not become permanent documentation

Use a GitHub issue, PR description, or short-lived branch document for implementation planning. Avoid committing permanent files such as:

```text
feature-v2.md
new-design-draft.md
migration-plan-temp.md
phase-3-notes.md
```

When the feature lands:

1. copy durable decisions into the appropriate canonical document;
2. update `status.md` and `roadmap.md` when necessary;
3. delete the temporary document.

A completed design note should not compete with the canonical docs for an Agent's attention.

## Avoid duplicated facts

Prefer links to the canonical source rather than repeating the same changing value in multiple documents.

Examples:

- exact CLI version: `packages/cli/package.json` + `apps/web/public/agent.json`;
- current public Agent capabilities: `agent.json`;
- Dou Dizhu legality: rules implementation/tests + `doudizhu-rules.md`;
- runtime endpoints: Worker implementation + `protocol.md`.

Human-facing installation docs should normally use:

```bash
npm install -g @waitloop/cli@alpha
```

rather than hard-coding a particular alpha patch version.

## What belongs in `status.md`

`status.md` is a compact current-state snapshot for handoff between agents/conversations. It contains:

- currently available capabilities;
- important current architectural facts;
- known gaps that materially affect work;
- current validation/deployment expectations.

It is **not** a changelog. Completed historical phases and obsolete setup steps do not belong there.

## What belongs in `roadmap.md`

`roadmap.md` contains only future work that is still relevant. Once an item is implemented, remove it and put any lasting behavioral rule in its canonical document.

## Validation

`pnpm check:repo-contract` verifies important synchronization invariants, including:

- CLI package/Agent manifest consistency;
- required Agent discovery/install/join/MCP references;
- all canonical Markdown files being discoverable from this index;
- absence of exact CLI release numbers in stable user-facing docs.

CI runs this validator along with TypeScript/tests, CLI package validation, browser JavaScript validation, and Wrangler dry-run bundling.