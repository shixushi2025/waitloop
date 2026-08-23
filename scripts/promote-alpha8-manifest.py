from __future__ import annotations

import json
from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    file.write_text(text.replace(old, new))


manifest_path = Path("apps/web/public/agent.json")
manifest = json.loads(manifest_path.read_text())
cli = manifest["cli"]
if cli.get("version") != "0.1.0-alpha.7":
    raise SystemExit(f"expected published alpha.7 before promotion, found {cli.get('version')}")
if cli.get("candidateVersion") != "0.1.0-alpha.8" or cli.get("candidatePublished") is not False:
    raise SystemExit("alpha.8 must still be the unpublished candidate before promotion")
cli["version"] = "0.1.0-alpha.8"
cli["published"] = True
cli["publicationVerification"] = (
    "alpha.8 was published through npm trusted publishing; the exact version and alpha dist-tag were verified, "
    "a clean @alpha installation passed, and the packaged MCP stdio/MCP Apps bridge was validated"
)
for key in ("candidateVersion", "candidatePublished", "candidateSummary"):
    cli.pop(key, None)
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

replace_once(
    "docs/status.md",
    '''Published CLI alpha:\n\n```text\n0.1.0-alpha.7\n```\n\nCurrent source/build candidate:\n\n```text\n0.1.0-alpha.8\ncandidatePublished: false\n```\n\nAlpha.7 includes the Human-operated MCP App path and has been verified on the npm registry with the `alpha` dist-tag pointing to `0.1.0-alpha.7`. Alpha.8 is source-only until its release workflow verifies the exact package and moves the npm `alpha` dist-tag; it must not be described as installable yet.\n''',
    '''Published CLI alpha:\n\n```text\n0.1.0-alpha.8\n```\n\nAlpha.8 was published through npm trusted publishing. The release workflow verified the exact package version, confirmed the npm `alpha` dist-tag points to `0.1.0-alpha.8`, installed `@waitloop/cli@alpha` into a clean prefix, and validated the packaged MCP stdio/MCP Apps bridge before recording publication success.\n''',
    "status release block",
)
replace_once(
    "docs/status.md",
    "The published alpha.7 provides:\n",
    "The published alpha.8 provides:\n",
    "status current MCP App release",
)
replace_once(
    "docs/status.md",
    "The alpha.8 source candidate changes compact history and request behavior in this area:",
    "Alpha.8 changes compact history and request behavior in this area:",
    "status alpha.8 feature wording",
)
replace_once(
    "docs/status.md",
    "A real Codex desktop client session has manually rendered and operated the published alpha.7 App.",
    "A real Codex desktop client session first manually rendered and operated the App on alpha.7; alpha.8 preserves that path and adds the bounded refresh/request-budget fixes.",
    "status Codex verification wording",
)
replace_once(
    "docs/status.md",
    "- no continuous idle polling from the Human MCP App;\n",
    "- visible-only Human MCP App safety refresh bounded from 5 to 30 seconds, with immediate mutation-driven updates and hidden/teardown cleanup;\n",
    "status request-budget test wording",
)

print("alpha.8 publication manifest promoted")
