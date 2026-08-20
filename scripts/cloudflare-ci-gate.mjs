const REPOSITORY = "shixushi2025/waitloop";
const DEFAULT_REQUIRED_CHECK_NAME = "ready-to-deploy";
const REQUIRED_APP_SLUG = "github-actions";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 20 * 1000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredCheckName() {
  const value = process.env.WAITLOOP_REQUIRED_CHECK_NAME?.trim();
  return value && value.length <= 128 ? value : DEFAULT_REQUIRED_CHECK_NAME;
}

export function selectRequiredCheck(runs, sha, checkName = DEFAULT_REQUIRED_CHECK_NAME) {
  if (!Array.isArray(runs)) return null;
  return runs
    .filter((run) =>
      isRecord(run) &&
      run.name === checkName &&
      run.head_sha === sha &&
      isRecord(run.app) &&
      run.app.slug === REQUIRED_APP_SLUG,
    )
    .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0] ?? null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkRunsUrl(sha, checkName) {
  return `https://api.github.com/repos/${REPOSITORY}/commits/${encodeURIComponent(sha)}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100`;
}

async function readCheckRuns(sha, checkName) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "waitloop-cloudflare-ci-gate",
    "x-github-api-version": "2026-03-10",
  };
  const token = process.env.WAITLOOP_GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(checkRunsUrl(sha, checkName), { headers });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const suffix = remaining === "0" ? " GitHub API rate limit was exhausted." : "";
    throw new Error(`GitHub Checks API returned HTTP ${response.status}.${suffix}`);
  }

  const body = await response.json();
  if (!isRecord(body) || !Array.isArray(body.check_runs)) {
    throw new Error("GitHub Checks API returned an invalid response.");
  }
  return body.check_runs;
}

export async function waitForRequiredCheck(sha, options = {}) {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const pollMs = positiveInteger(options.pollMs, DEFAULT_POLL_MS);
  const checkName = typeof options.checkName === "string" && options.checkName.length > 0
    ? options.checkName
    : DEFAULT_REQUIRED_CHECK_NAME;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "not-created";

  while (Date.now() <= deadline) {
    const run = selectRequiredCheck(await readCheckRuns(sha, checkName), sha, checkName);
    if (!run) {
      if (lastStatus !== "not-created") console.log(`GitHub Actions ${checkName} is not visible yet; continuing to wait.`);
      lastStatus = "not-created";
    } else if (run.status === "completed") {
      if (run.conclusion === "success") {
        console.log(`GitHub Actions ${checkName} succeeded for ${sha}.`);
        return;
      }
      throw new Error(`GitHub Actions ${checkName} completed with conclusion ${String(run.conclusion)}.`);
    } else {
      const status = typeof run.status === "string" ? run.status : "unknown";
      if (status !== lastStatus) console.log(`GitHub Actions ${checkName} is ${status}; continuing to wait.`);
      lastStatus = status;
    }
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error(`Timed out waiting for GitHub Actions ${checkName} on ${sha}.`);
}

function selfTest() {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const checkName = "check";
  const selected = selectRequiredCheck([
    { id: 99, name: "Cloudflare Workers", head_sha: sha, app: { slug: "cloudflare-workers-and-pages" } },
    { id: 10, name: checkName, head_sha: sha, app: { slug: REQUIRED_APP_SLUG }, status: "completed", conclusion: "failure" },
    { id: 11, name: checkName, head_sha: sha, app: { slug: REQUIRED_APP_SLUG }, status: "completed", conclusion: "success" },
    { id: 12, name: checkName, head_sha: "ffffffffffffffffffffffffffffffffffffffff", app: { slug: REQUIRED_APP_SLUG } },
  ], sha, checkName);

  if (!selected || selected.id !== 11 || selected.conclusion !== "success") {
    throw new Error("Cloudflare CI gate self-test failed to select the latest matching GitHub Actions check.");
  }
  if (selectRequiredCheck([], sha, checkName) !== null) {
    throw new Error("Cloudflare CI gate self-test expected no match for an empty check list.");
  }
  console.log("Cloudflare CI gate self-test passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  if (process.env.WORKERS_CI !== "1" || process.env.WORKERS_CI_BRANCH !== "main") return;

  const sha = process.env.WORKERS_CI_COMMIT_SHA?.trim();
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error("Cloudflare production build is missing a valid WORKERS_CI_COMMIT_SHA.");
  }

  const checkName = requiredCheckName();
  console.log(`Waiting for GitHub Actions ${checkName} before Cloudflare deploy of ${sha}.`);
  await waitForRequiredCheck(sha, {
    checkName,
    timeoutMs: positiveInteger(process.env.WAITLOOP_CI_GATE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollMs: positiveInteger(process.env.WAITLOOP_CI_GATE_POLL_MS, DEFAULT_POLL_MS),
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`waitloop Cloudflare CI gate: ${message}`);
  process.exitCode = 1;
});
