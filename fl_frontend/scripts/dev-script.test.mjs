import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The frontend's directory, where `pnpm dev` runs the script and resolves its paths.
const FRONTEND = path.join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const DEV_SCRIPT = JSON.parse(readFileSync(path.join(FRONTEND, "package.json"), "utf8")).scripts.dev;
// The `dev` script's assignments, between `cross-env` and the `next dev` they are handed to.
const ASSIGNMENTS = /^cross-env ((?:\S+=\S+ )+)next dev( |$)/.exec(DEV_SCRIPT)?.[1]?.trim().split(" ") ?? [];
const CROSS_ENV = fileURLToPath(import.meta.resolve("cross-env/bin/cross-env"));

// Holds no environment file, so nothing but the script and the shell can hand the server a name.
const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-dev-script-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

// A file, never `-e`: the program's quoted backslashes do not survive cross-env re-spawning it on Windows.
const NEXT_READS = path.join(SCRATCH, "next-reads.cjs");
// Next's own loader, as `next dev` runs it over `fl_frontend/.env`, handed that file's text rather
// than a file: it keeps a name the process started with, so this prints what reaches the server.
writeFileSync(
  NEXT_READS,
  `
const { processEnv } = require(${JSON.stringify(createRequire(require.resolve("next/package.json")).resolve("@next/env"))});
processEnv([{ path: ".env", contents: "FL_DEV_PROBE_PACKAGE=from-the-package-file\\nFL_DEV_PROBE_SHELL=from-the-package-file\\nACTOR_SIGNING_KEY_FILE=from-the-package-file\\nSECRETS_DIR=from-the-package-file\\n" }], ".");
const { FL_DEV_PROBE_PACKAGE, FL_DEV_PROBE_SHELL, ACTOR_SIGNING_KEY_FILE, SECRETS_DIR } = process.env;
process.stdout.write(JSON.stringify({ probes: { FL_DEV_PROBE_PACKAGE, FL_DEV_PROBE_SHELL }, keyFile: ACTOR_SIGNING_KEY_FILE, secretsDir: SECRETS_DIR }));
`,
);

/** What the dev server's environment holds, started by the `dev` script's own assignments. */
function served() {
  assert.ok(ASSIGNMENTS.length > 0, `the dev script sets no variable before next dev: ${DEV_SCRIPT}`);
  const said = execFileSync(process.execPath, [CROSS_ENV, ...ASSIGNMENTS, process.execPath, NEXT_READS], {
    cwd: SCRATCH,
    env: { ...process.env, FL_DEV_PROBE_SHELL: "from-the-shell", ACTOR_SIGNING_KEY_FILE: "from-the-shell", SECRETS_DIR: "from-the-shell" },
    encoding: "utf8",
    timeout: 30_000,
  });
  return JSON.parse(said);
}

describe("the dev script", () => {
  // Every credential is a file under `secrets/`, so an environment file of the script's own would
  // hand the server nothing it reads.
  it("starts Next with the variables it sets and no environment file of its own", () => {
    assert.ok(ASSIGNMENTS.length > 0, DEV_SCRIPT);
    assert.ok(
      ASSIGNMENTS.every((assignment) => /^[A-Z_]+=/.test(assignment)),
      DEV_SCRIPT,
    );
  });

  it("hands the server the shell's value, then fl_frontend/.env's", () => {
    assert.deepEqual(served().probes, { FL_DEV_PROBE_PACKAGE: "from-the-package-file", FL_DEV_PROBE_SHELL: "from-the-shell" });
  });

  // Named by the script rather than in `fl_frontend/.env`, which the container reads too: a path
  // there turns the container away from its secret's mount, and its boot refuses (`docs/ops/spec.md :: I472`).
  it("hands the server the checkout's signing key file over the shell and fl_frontend/.env", () => {
    assert.equal(path.resolve(FRONTEND, served().keyFile), path.resolve(FRONTEND, "..", "secrets", "fl_actor_signing_key"));
  });

  // The same reason for the directory every other secret file is read from.
  it("hands the server the checkout's secrets directory over the shell and fl_frontend/.env", () => {
    assert.equal(path.resolve(FRONTEND, served().secretsDir), path.resolve(FRONTEND, "..", "secrets"));
  });
});
