# CLI release and npm publishing

Waitloop publishes the local integration CLI as the public scoped package:

```text
@waitloop/cli
```

The first published release is:

```text
0.1.0-alpha.1
```

Alpha installs use the `alpha` npm dist-tag:

```bash
npm install -g @waitloop/cli@alpha
```

## Release invariants

A CLI release is not ready unless all of these agree:

- `packages/cli/package.json` package name and version;
- `apps/web/public/agent.json` CLI package name, version, dist-tag, and install command;
- `waitloop --version` from the built package;
- the GitHub Release tag `cli-v<version>` for normal post-bootstrap releases.

CI enforces the package/manifest/binary invariants. The normal publish workflow enforces the release tag.

The package is restricted to the built `dist/` output plus package README/LICENSE. `pnpm check:cli-package` runs `npm pack --dry-run --json`, checks the tarball contents, and executes the built CLI's `--version` command.

## Publish workflow

The normal workflow is:

```text
.github/workflows/publish-cli.yml
```

It runs only for a published GitHub Release whose tag starts with `cli-v`.

For `0.1.0-alpha.1`, the canonical release tag is:

```text
cli-v0.1.0-alpha.1
```

The workflow:

1. checks out the release tag;
2. installs pnpm and Node 24;
3. uses npm 11;
4. performs a frozen dependency install;
5. runs TypeScript/tests;
6. validates browser JavaScript;
7. validates the npm tarball and CLI version;
8. verifies the release tag matches `package.json`;
9. checks whether that exact npm version already exists;
10. publishes only when necessary;
11. verifies the expected version is visible from npm.

Pre-release identifiers determine the npm dist-tag. For example:

```text
0.1.0-alpha.1 -> alpha
0.1.0-beta.1  -> beta
0.1.0-rc.1    -> rc
0.1.0         -> latest
```

## First publish bootstrap — completed

The first publication was bootstrapped with a temporary granular npm credential because Trusted Publishing is configured after the npm package exists.

Verified result:

```text
@waitloop/cli@0.1.0-alpha.1
npm dist-tag: alpha
```

The temporary bootstrap workflow path was removed from `main` after publication. Normal future publishing goes through a GitHub Release.

`apps/web/public/agent.json` is now marked:

```json
{
  "cli": {
    "published": true
  }
}
```

so installer agents can use the npm package directly.

## Switch to npm Trusted Publishing

Configure the npm package Trusted Publisher to GitHub Actions with:

```text
GitHub user/organization: shixushi2025
Repository:              waitloop
Workflow filename:       publish-cli.yml
Environment:             none
```

The workflow already grants `id-token: write` and uses a supported Node/npm version. Once trusted publishing is configured, npm can authenticate publication with short-lived OIDC credentials and generate provenance from the public GitHub repository.

After Trusted Publishing is configured:

1. remove the `NODE_AUTH_TOKEN` / `NPM_TOKEN` fallback from `publish-cli.yml`;
2. delete the GitHub repository secret `NPM_TOKEN`;
3. optionally configure npm package publishing access to disallow traditional publish tokens;
4. keep the workflow filename stable unless the npm Trusted Publisher configuration is updated at the same time.

## Preparing the next version

For each later release:

1. update `packages/cli/package.json` version;
2. update `apps/web/public/agent.json` CLI version and dist-tag/install command if the release channel changes;
3. run:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:cli-package
```

4. wait for `main` CI to pass;
5. create a GitHub Release with exact tag `cli-v<version>`;
6. verify the `publish-cli` workflow succeeds;
7. verify the package/version and expected dist-tag on npm.

Never reuse a previously published npm version.
