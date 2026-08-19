# CLI release and npm publishing

Waitloop publishes the local integration CLI as the public scoped package:

```text
@waitloop/cli
```

The first release candidate is:

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
- the GitHub Release tag `cli-v<version>`.

CI enforces the first three. The publish workflow enforces the release tag.

The package is restricted to the built `dist/` output plus package README/LICENSE. `pnpm check:cli-package` runs `npm pack --dry-run --json`, checks the tarball contents, and executes the built CLI's `--version` command.

## Publish workflow

The workflow is:

```text
.github/workflows/publish-cli.yml
```

It runs only for a published GitHub Release whose tag starts with `cli-v`.

For `0.1.0-alpha.1`, the release tag must be exactly:

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
9. publishes with public access, provenance, and the version-derived dist-tag.

Pre-release identifiers determine the npm dist-tag. For example:

```text
0.1.0-alpha.1 -> alpha
0.1.0-beta.1  -> beta
0.1.0-rc.1    -> rc
0.1.0         -> latest
```

## One-time first publish bootstrap

npm trusted publishing is configured on an existing package, so the first publication may need a one-time traditional publish credential.

Before the first release:

1. confirm the npm account/organization controls the `@waitloop` scope;
2. confirm `@waitloop/cli` can be created under that scope;
3. create a granular npm access token with only the permissions needed to publish this package and with the required 2FA publishing behavior;
4. add it temporarily to this GitHub repository as the Actions secret `NPM_TOKEN`;
5. publish the GitHub Release `cli-v0.1.0-alpha.1`.

The workflow accepts `NPM_TOKEN` only as a bootstrap fallback. It should not remain the long-term publishing mechanism.

If the first publish fails because the scope/package cannot be created, do not rename the package casually in the workflow. Decide the canonical CLI package name first, then update `package.json`, `agent.json`, documentation, and CI together.

## Switch to npm Trusted Publishing

After the package exists on npm, configure its Trusted Publisher to GitHub Actions with:

```text
GitHub user/organization: shixushi2025
Repository:              waitloop
Workflow filename:       publish-cli.yml
Allowed action:          npm publish
Environment:             none (unless a GitHub environment is deliberately added later)
```

The workflow already grants `id-token: write` and uses a supported Node/npm version. Once trusted publishing is configured, npm can authenticate the publish with short-lived OIDC credentials and generate provenance from the public GitHub repository.

After one successful OIDC publication:

1. delete the GitHub `NPM_TOKEN` secret;
2. optionally configure npm package publishing access to disallow traditional tokens;
3. keep the workflow filename stable unless the npm Trusted Publisher configuration is updated at the same time.

## Mark the public Agent manifest as published

Before the first npm publication, `apps/web/public/agent.json` intentionally contains:

```json
{
  "cli": {
    "published": false
  }
}
```

After the first npm publish is verified, change it to:

```json
{
  "cli": {
    "published": true
  }
}
```

and deploy the Worker/static assets. `/agent.md` tells installer agents to use npm only when this flag is true; otherwise they use the source-install fallback.

This one-time flag avoids telling an automated agent to install a package before it really exists.

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
