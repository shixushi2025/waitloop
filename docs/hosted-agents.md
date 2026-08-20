# Hosted game agents

Hosted Agents are server-side model-backed **Actors** bound as Controllers of a game Seat. They are distinct from deterministic Bots and external Connected Agents.

## Runtime model

```text
Seat
  <- Bot Actor              deterministic, no model
  <- Hosted Agent Actor     Worker calls provider
  <- Connected Agent Actor  external MCP client
```

All use the same server-authoritative game engine. Game packages see the Seat ID, not provider/client kind.

Hosted model input contains only the private/public projection of its controlled Seat plus server-generated legal move IDs. Opponent hands, coding-agent prompts/source, and credentials are excluded.

## Configuration

Worker secrets:

```text
DEEPSEEK_API_KEY
OPENAI_API_KEY
```

Optional overrides:

```text
WAITLOOP_DEEPSEEK_MODEL
WAITLOOP_OPENAI_MODEL
WAITLOOP_HOSTED_AGENT_TIMEOUT_MS
```

Current defaults remain provider-specific in `worker/src/hosted-agent.ts`. Secrets remain server-side.

## Provider contract

Conceptually:

```json
{
  "game": "doudizhu",
  "revision": 12,
  "yourPlayerId": "seat-2",
  "currentPlayerId": "seat-2",
  "visibleState": {},
  "legalMoves": [
    { "id": "move-1", "label": "JJ" },
    { "id": "pass", "label": "pass" }
  ]
}
```

Provider returns a move ID. Waitloop validates it against the exact current legal set.

## Failure behavior

Provider timeout/error/invalid output/nonexistent move ID falls back to a deterministic legal move. Runtime stats track calls/tokens/latency/fallback/errors.

Provider transport timeout is resource protection, not a Casual game clock.

## Cost / abuse protection

Public hosted-Agent Room creation currently has a tighter Cloudflare Rate Limiting binding than ordinary Room creation. This reduces easy inference amplification but is not cost accounting.

Before broader public exposure, hosted inference still needs explicit per-user/Actor/Room budgets or quotas and observability.

## Privacy

Hosted providers receive only their controlled Seat projection and legal moves. They never receive:

- unrelated Seat hidden hands;
- coding-agent lifecycle prompt/source/tool content;
- browser anonymous Actor credential;
- Room viewer credential;
- Connected Agent MCP credential.

## Current discovery

Configured providers are exposed by:

```text
GET /api/v1/hosted-agents
```

Only configured providers appear in the Human UI.

Future Arena work may compare multiple hosted/controller Actors, but Arena policy remains separate from Casual Waitloop.
