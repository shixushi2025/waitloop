# CLI release and npm publishing

Waitloop publishes the local integration CLI as the public scoped package:

```text
@waitloop/cli
```

Alpha users install the channel rather than a hard-coded patch version:

```bash
npm install -g @waitloop/cli@alpha
```

## Release-state truth sources

Do not treat “the current CLI version” as one value during release preparation. Waitloop deliberately has three different truth sources:

```text
Source/build truth
  packages/cli/package.json
  = version produced by the current source tree
  = may be an unpublished candidate

Declared published/installable truth
  apps/web/public/agent.json -> cli.version
  = version Waitloop publicly declares as published
  candidateVersion + candidatePublished:false
  = optional source-ahead staging state

Registry truth
  npm registry + dist-tag
  = final authority for what
    npm install -g @waitloop/cli@alpha
    actually installs
```

This distinction is intentional. A new CLI version must exist in source before it can be built, tested, and published, so `packages/cli/package.json` can legitimately move ahead of npm.

Example while the next alpha is staged but not published:

```json
// packages/cli/package.json
{ "version": "0.1.0-alpha.8" }

// apps/web/public/agent.json
{
  "cli": {
    "version": "0.1.0-alpha.7",
    "candidateVersion": "0.1.0-alpha.8",
    "candidatePublished": false,
    "distTag": "alpha",
    "published": true
  }
}
```

That state means:

```text
source/build produces alpha.8
public @alpha still installs alpha.7
alpha.8 must not be described as user-installable yet
```

After npm publication and registry verification:

```json
// packages/cli/package.json
{ "version": "0.1.0-alpha.8" }

// apps/web/public/agent.json
{
  "cli": {
    "version": "0.1.0-alpha.8",
    "distTag": "alpha",
    "published": true
  }
}
```

The candidate fields are removed only after registry confirmation.

### Availability rule

Never infer npm availability from any of these alone:

```text
code merged to main
package.json version changed
Cloudflare/Web deployment succeeded
MCP tool exists in repository source
CI/package tests passed
```

Those facts prove source/build availability, not npm installability.

Before saying that users can install version X or receive feature Y through `@alpha`, verify the npm registry/dist-tag (normally in the trusted publishing workflow, or with an explicit registry query). The registry is the external authority for what the install command resolves to.

This is why source and npm can temporarily look “mismatched”: the mismatch is a valid candidate-staging state. The bug is only when documentation, an Agent, or release metadata treats that candidate as already published.

## Release invariants

A CLI release candidate is internally consistent when:

- `packages/cli/package.json` contains the source/build version;
- if that version is not yet published, `agent.json.cli.version` remains the current published version while `candidateVersion` equals the package version and `candidatePublished` is `false`;
- if the package version is already published, `agent.json.cli.version` equals it and candidate fields are absent;
- `agent.json.cli.distTag` and `installCommand` describe the **published version/channel**, not an unpublished source candidate;
- packaged `waitloop --version` equals `packages/cli/package.json`;
- public Agent documentation uses stable channel commands such as `@waitloop/cli@alpha` unless exact release metadata is required.

A release is externally complete only after npm confirms both:

```text
@waitloop/cli@<exact version> exists
requested dist-tag resolves to that version
```

`pnpm check:cli-package` validates the tarball/source candidate and release-state declaration. `pnpm check:repo-contract` validates cross-surface release-state/documentation invariants. These checks are deterministic and do not make normal CI depend on npm network availability; actual Registry truth is verified by the release workflow.

## Trusted publishing

Normal publication uses npm Trusted Publishing with GitHub Actions OIDC.

Trusted Publisher identity:

```text
GitHub owner:      shixushi2025
Repository:        waitloop
Workflow filename: publish-cli.yml
Environment:       none
Allowed action:    npm publish
```

Workflow requirements:

```yaml
permissions:
  contents: read
  id-token: write
```

Do not add a long-lived `NPM_TOKEN`/`NODE_AUTH_TOKEN` back to the normal publication path unless there is an explicit, reviewed emergency migration reason.

## Publish workflow

Canonical workflow:

```text
.github/workflows/publish-cli.yml
```

Normal trigger: a published GitHub Release whose tag is exactly:

```text
cli-v<packages/cli/package.json version>
```

The workflow:

1. checks out the release tag;
2. sets up pnpm and a Trusted-Publishing-compatible Node/npm version;
3. installs dependencies from the frozen lockfile;
4. runs TypeScript/tests;
5. validates repository/onboarding contracts and browser JavaScript;
6. validates the CLI npm package/tarball and packaged MCP wire contract;
7. verifies release tag == package version;
8. checks whether the exact npm version already exists;
9. publishes with provenance only when necessary;
10. verifies the expected exact version is visible on npm;
11. clean-installs the published package and validates CLI/MCP behavior;
12. verifies the intended npm dist-tag resolves to the released version before public metadata is promoted.

Prerelease identifiers determine the release channel requested by the release:

```text
x.y.z-alpha.n -> alpha
x.y.z-beta.n  -> beta
x.y.z-rc.n    -> rc
x.y.z         -> latest
```

During a source-ahead candidate state, the public `agent.json` channel remains tied to its published version until the new channel/version has actually been published.

## Preparing a release

1. Update `packages/cli/package.json` to the candidate version.
2. Update `apps/web/public/agent.json` without pretending publication already happened:
   - keep `cli.version` on the currently published version;
   - set `candidateVersion` to the package/source version;
   - set `candidatePublished:false`;
   - keep `distTag`/`installCommand` describing the currently published channel;
   - update capability fields for candidate behavior as needed, labeling candidate-only support accurately.
3. If CLI behavior changed, update in the same change:
   - `packages/cli/README.md`;
   - `docs/cli.md`;
   - `apps/web/public/agent.md`;
   - `apps/web/public/skills/waitloop/SKILL.md`;
   - `llms.txt` if discovery/entrypoints changed.
4. Run:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
pnpm check:mcp-stdio
```

5. Wait for `main` CI.
6. Create/publish GitHub Release `cli-v<package version>`.
7. Verify `publish-cli` succeeds through OIDC.
8. Verify the exact npm package and intended dist-tag from the registry.
9. Clean-install that exact published package and run release smoke validation.
10. Only then promote `agent.json.cli.version` to the new published version and remove `candidateVersion` / `candidatePublished`.
11. Update `status.md`/roadmap only if publication changes current durable state or future work.

Never reuse a published npm version.

## Answering availability questions

Repository-editing Agents and maintainers must distinguish these questions:

```text
“What version is in source?”
  -> packages/cli/package.json

“What version does Waitloop declare published?”
  -> apps/web/public/agent.json -> cli.version

“What will npm install -g @waitloop/cli@alpha install right now?”
  -> npm registry alpha dist-tag
```

If the question is about what an external user can install **now**, registry evidence outranks repository inference. If registry access is unavailable, report the declared published version separately and do not silently substitute the package/source version.

## Version documentation rule

Do not update every Markdown file with each alpha patch number. Stable human-facing docs should use the channel install command. Exact source/build version belongs in `packages/cli/package.json`; declared published version belongs in `agent.json`; actual installability belongs to npm Registry/dist-tag verification and release records.

This minimizes documentation drift while preserving the important distinction between source candidate state and externally installable state.