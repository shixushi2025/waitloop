# Release stabilization checklist

Temporary execution checklist for the current alpha.6 stabilization pass. Remove this file when the pass is complete.

- [x] Close `docs/mcp.md` repository contract and document `agent-bots` yield semantics.
- [x] Finalize lifecycle state on `SessionEnd` instead of leaving stale `running`/`waiting` state.
- [x] Add lifecycle terminal/idempotency regression tests.
- [x] Add packaged MCP stdio wire validation.
- [x] Gate normal CI and CLI release CI on the MCP wire validation.
- [ ] Full branch validation green.
- [ ] Merge validated changes to `main`.
- [ ] Publish `@waitloop/cli@0.1.0-alpha.6` through trusted publishing.
- [ ] Verify clean installation from the npm `alpha` dist-tag.
- [ ] Mark alpha.6 as published in `agent.json` and public docs.
- [ ] Ensure deployment occurs only from a green commit.
