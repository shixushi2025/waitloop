# CLI release and npm publishing

Waitloop publishes the local integration CLI as the public scoped package:

```text
@waitloop/cli
```

Alpha users install the channel rather than a hard-coded patch version:

```bash
npm install -g @waitloop/cli@alpha
```

The exact current version is authoritative in `packages/cli/package.json` and `apps/web/public/agent.json`.

## Release invariants

A CLI release is not ready unless these agree:

- `packages/cli/package.json` package name/version;
- `apps/web/public/agent.json` package/version/dist-tag/install/join capability metadata;
- packaged `waitloop --version`;
- GitHub Release tag `cli-v<version>`;
- public Agent documentation when CLI-visible behavior changed.

`pnpm check:cli-package` validates the npm tarball contents and packaged CLI version. `pnpm check:repo-contract` validates cross-surface documentation/manifest invariants.

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
5. validates browser JavaScript;
6. validates the CLI npm package/tarball;
7. verifies release tag == package version;
8. checks whether the exact npm version already exists;
9. publishes with provenance only when necessary;
10. verifies the expected version is visible on npm.

Prerelease identifiers determine the npm dist-tag:

```text
x.y.z-alpha.n -> alpha
x.y.z-beta.n  -> beta
x.y.z-rc.n    -> rc
x.y.z         -> latest
```

## Preparing a release

1. Update `packages/cli/package.json` version.
2. Update `apps/web/public/agent.json`:
   - exact version/candidate version as appropriate;
   - dist-tag if the channel changes;
   - capability fields if commands changed.
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
```

5. Wait for `main` CI.
6. Create/publish GitHub Release `cli-v<version>`.
7. Verify `publish-cli` succeeds through OIDC.
8. Verify npm package/dist-tag.
9. Ensure `agent.json` reports the newly published version rather than a candidate.

Never reuse a published npm version.

## Version documentation rule

Do not update every Markdown file with each alpha patch number. Stable human-facing docs should use the channel install command. Exact version belongs in machine/package metadata and release records.

This minimizes documentation drift while keeping automated agents able to discover the precise current package version from `agent.json`.