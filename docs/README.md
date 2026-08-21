# Waitloop documentation

This directory contains the **current durable documentation** for Waitloop. It is intentionally not a history of every implementation stage.

For a new human or coding agent, use this reading order:

1. [`../README.md`](../README.md) — product/repository entry point.
2. [`status.md`](status.md) — what is implemented now and what is still missing.
3. [`architecture.md`](architecture.md) — runtime boundaries, Human MCP App path, and module responsibilities.
4. Read only the canonical document(s) relevant to the subsystem you are changing.
5. Confirm details against implementation and tests.

Repository-editing agents must also follow [`../AGENTS.md`](../AGENTS.md).

## Canonical sources

| Topic | Canonical document |
| --- | --- |
| Product intent, user journey, non-goals | [`product.md`](product.md) |
| Current architecture and responsibility boundaries | [`architecture.md`](architecture.md) |
| Wire contracts, MCP Apps messages, and public API semantics | [`protocol.md`](protocol.md) |
| Security, privacy, credentials, App capabilities, trust boundaries | [`security.md`](security.md) |
| Generic game runtime, room phases, human/agent projections | [`game-system.md`](game-system.md) |
| Current Dou Dizhu rules | [`doudizhu-rules.md`](doudizhu-rules.md) |
| Local/remote MCP, Human MCP App, Agent Seat behavior | [`mcp.md`](mcp.md) |
| CLI, lifecycle adapters, Join, local Human App state | [`cli.md`](cli.md) |
| Device/browser pairing | [`pairing.md`](pairing.md) |
| Hosted model players | [`hosted-agents.md`](hosted-agents.md) |
| Visual and interaction language | [`design.md`](design.md) |
| CLI release procedure | [`cli-release.md`](cli-release.md) |
| Current implemented state and known gaps | [`status.md`](status.md) |
| Forward-looking priorities only | [`roadmap.md`](roadmap.md) |

## Product-facing Agent surfaces

These are public product interfaces and must stay synchronized with code and canonical docs:

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

Their sources are under `apps/web/public/` plus Worker MCP/Join/Room implementation and `packages/cli`.

The Human MCP App is a local MCP resource rather than a public HTTP page:

```text
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
```

Its canonical contract is documented in `mcp.md`, `protocol.md`, `security.md`, and `architecture.md`.

## Documentation lifecycle

### Main contains current truth

A document on `main` should help someone understand or operate the **current system**. It should not require the reader to know which implementation phase came before or after it.

When a feature changes, update its canonical document in the same change as code. Documentation drift is a bug.

### Temporary design work does not become permanent documentation

Use a GitHub issue, PR description, or short-lived branch document for implementation planning. Avoid permanent files such as:

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

A completed design note should not compete with canonical docs for an Agent's attention.

## Avoid duplicated facts

Prefer links to the canonical source rather than repeating the same changing value in multiple documents.

Examples:

- exact CLI version: `packages/cli/package.json` + `apps/web/public/agent.json`;
- current public Agent/MCP App capabilities: `agent.json`;
- Dou Dizhu legality: rules implementation/tests + `doudizhu-rules.md`;
- runtime endpoints: Worker implementation + `protocol.md`;
- Human App privacy: `security.md`.

Human-facing installation docs should normally use:

```bash
npm install -g @waitloop/cli@alpha
```

rather than hard-coding an alpha patch version.

## What belongs in `status.md`

`status.md` is a compact current-state snapshot for handoff between agents/conversations. It contains:

- currently available capabilities;
- important current architectural facts;
- known gaps that materially affect work;
- current validation/deployment expectations.

It is **not** a changelog. Completed historical phases and obsolete setup steps do not belong there.

## What belongs in `roadmap.md`

`roadmap.md` contains only future work that is still relevant. Once an item is implemented, remove it and put lasting behavioral rules in canonical docs.

## Validation

`pnpm check:repo-contract` verifies synchronization invariants including:

- CLI package/Agent manifest candidate or published-version consistency;
- required Agent discovery/install/join/local+remote MCP references;
- Human `open_game` versus Agent `create_room` distinction;
- MCP App resource URI/MIME/protocol, app-only tools, private capability, and fallback guidance;
- all canonical Markdown files being discoverable from this index;
- absence of exact CLI release numbers in stable user-facing docs.

CI also runs:

```text
TypeScript
88 unit/regression tests
CLI npm package validation
embedded MCP App JavaScript syntax validation
packaged stdio tools/resources wire validation
standalone browser JavaScript validation
Agent discovery validation
Cloudflare gate self-test
Wrangler dry-run
```
