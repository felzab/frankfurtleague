/**
 * CI · expose the Actions cache credentials to `run:` steps.
 *
 * The runner injects ACTIONS_RUNTIME_TOKEN and ACTIONS_RESULTS_URL — what buildx's type=gha cache
 * authenticates with — into JavaScript actions alone, never into a `run:` step, so this action reads
 * them and writes them to $GITHUB_ENV. Dependency-free and in-tree, it is less surface than a third
 * party one and needs no allowlist entry (`docs/_git/spec.md`).
 *
 * Invariants:
 * - The token is masked before it is exported; the mask is what makes exporting it safe.
 * - Nothing here prints a value — only names.
 */

const { appendFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");

// ACTIONS_CACHE_SERVICE_V2 is forwarded, never pinned here: buildx reads it to choose between the
// v1 endpoint (ACTIONS_CACHE_URL) and the v2 one (ACTIONS_RESULTS_URL), and hardcoding the wrong
// choice disables the cache silently.
const NAMES = ["ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL", "ACTIONS_CACHE_SERVICE_V2"];

// Only the token is a credential; the other three are service endpoints and a boolean.
const SECRETS = new Set(["ACTIONS_RUNTIME_TOKEN"]);

const githubEnv = process.env.GITHUB_ENV;
if (!githubEnv) {
  console.error("GITHUB_ENV is not set — this action only runs inside GitHub Actions.");
  process.exit(1);
}

const exported = [];
for (const name of NAMES) {
  const value = process.env[name];
  if (!value) continue;

  // Mask first, then export. The other order leaves a window in which a later step could echo it
  // before the runner knows to redact it.
  if (SECRETS.has(name)) {
    console.log(`::add-mask::${value}`);
  }

  // The heredoc form, because a delimiter cannot collide with a value it was generated after. These
  // values are single-line today and the form costs nothing if that ever stops being true.
  const delimiter = `ghadelim_${randomUUID()}`;
  appendFileSync(githubEnv, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  exported.push(name);
}

// Names only, never values. A caller that sees an empty list knows the cache will not authenticate.
console.log(exported.length ? `exported: ${exported.join(", ")}` : "exported nothing — no Actions runtime in this environment");
