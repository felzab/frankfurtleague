// .github/actions/actions-runtime-env/index.js — expose the Actions cache credentials to `run:` steps.
//
// WHY THIS EXISTS -------------------------------------------------------------------------------
//
// buildx's type=gha cache backend authenticates to the Actions cache service with ACTIONS_RUNTIME_TOKEN
// and ACTIONS_RESULTS_URL. The runner injects those into the environment of JAVASCRIPT ACTIONS ONLY,
// never into a `run:` step — so `docker buildx build --cache-to type=gha` from a shell script cannot
// see them. Docker's own documentation says as much: "If you invoke the docker buildx command manually
// from an inline step, then the variables must be manually exposed."
//
// This is a JavaScript action, so it can read them, and it writes them to $GITHUB_ENV where every later
// step in the job can. That is the whole of it.
//
// WHY LOCAL RATHER THAN THE ACTION DOCKER POINTS AT ----------------------------------------------
//
// Docker recommends crazy-max/ghaction-github-runtime, which does exactly this. A local action was
// chosen instead because this repository allowlists third-party actions one at a time and pins each to
// an exact version, precisely to bound supply-chain surface (docs/workflows/README.md, Actions). Fifteen
// dependency-free lines in-tree are strictly less surface than a fourth third-party action, and they
// need no allowlist entry. ADR-0038 records the decision and what it costs.
//
// SECURITY --------------------------------------------------------------------------------------
//
// ACTIONS_RUNTIME_TOKEN is a credential. It is masked before it is exported, so the runner redacts it
// from every subsequent log line, and nothing here prints a value — only names. The mask is what makes
// exporting it safe; do not remove it.

const { appendFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");

// ACTIONS_RESULTS_URL is the v2 cache service; ACTIONS_CACHE_URL was v1. ACTIONS_CACHE_SERVICE_V2 is
// what buildx reads to decide between them, so it is forwarded rather than the version being pinned
// here — the runner is the authority on which service is live, and hardcoding the wrong one silently
// disables the cache.
const NAMES = [
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_RESULTS_URL",
  "ACTIONS_CACHE_URL",
  "ACTIONS_CACHE_SERVICE_V2",
];

// Only the token is a credential; the other three are service endpoints and a boolean.
const SECRETS = new Set(["ACTIONS_RUNTIME_TOKEN"]);

const githubEnv = process.env.GITHUB_ENV;
if (!githubEnv) {
  console.error(
    "GITHUB_ENV is not set — this action only runs inside GitHub Actions.",
  );
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
console.log(
  exported.length
    ? `exported: ${exported.join(", ")}`
    : "exported nothing — no Actions runtime in this environment",
);
