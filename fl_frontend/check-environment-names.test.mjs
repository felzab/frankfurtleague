import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { DECLARED_NAMES_FILE, ENVIRONMENT_FILE, scanNames, undeclaredNames } from "./check-environment-names.mjs";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const HERE = import.meta.dirname;
const CHECKER = path.join(HERE, "check-environment-names.mjs");
const MANIFEST = JSON.parse(readFileSync(path.join(HERE, "package.json"), "utf8"));
const DOCKERFILE = readFileSync(path.join(HERE, "Dockerfile"), "utf8");
const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-environment-names-"));

// Dummy names throughout, and files this suite writes itself: nothing here reads, mounts or names a
// real environment file.
const DECLARED = ["ALPHA_NAME", "BETA_NAME", "OMEGA_NAME"];
// One name per set rather than none: a default demanding nothing would let a case that forgets
// either required half read as a pass on it.
const SETS = { declared: DECLARED, required: ["ALPHA_NAME"], productionRequired: ["OMEGA_NAME"] };

/** One run of the checker over files written for the case, answering the code the deploy grades. */
function check(contents, { sets = SETS, flags = [] } = {}) {
  const stem = path.join(SCRATCH, `case-${String(process.hrtime.bigint())}`);
  writeFileSync(`${stem}.environment`, contents);
  if (sets !== null) writeFileSync(`${stem}.json`, JSON.stringify(sets));

  return spawnSync(process.execPath, [CHECKER, `${stem}.environment`, `${stem}.json`, ...flags], { encoding: "utf8" });
}

describe("the names read out of an environment file", () => {
  it("takes an assignment and a pass-through name, and neither a comment nor a blank line", () => {
    const file = ["# ALPHA_NAME is set elsewhere", "", "BETA_NAME=a value", "GAMMA_NAME", "   DELTA_NAME = spaced "].join("\n");

    assert.deepEqual(scanNames(file), {
      names: ["BETA_NAME", "DELTA_NAME", "GAMMA_NAME"],
      // `GAMMA_NAME` declares a name and gives no value: compose resolves a pass-through from the
      // shell that ran it, so nothing of that variable comes off this file.
      assigned: ["BETA_NAME", "DELTA_NAME"],
      unreadable: [],
    });
  });

  it("counts a name whose value is empty, which the backend's own reader drops before it is judged", () => {
    assert.deepEqual(scanNames("ALPHA_NAME=\n").names, ["ALPHA_NAME"]);
  });

  it("skips a quoted value running past its own line, so what is written inside one declares nothing", () => {
    const file = ['ALPHA_NAME="first line', "BETA_NAME=this line is data", 'last line"', "GAMMA_NAME=plain"].join("\n");

    assert.deepEqual(scanNames(file).names, ["ALPHA_NAME", "GAMMA_NAME"]);
  });

  it("reads a quoted value the same line closes, an escaped quote inside it included", () => {
    assert.deepEqual(scanNames('ALPHA_NAME="a \\" quote"\nBETA_NAME=plain\n').names, ["ALPHA_NAME", "BETA_NAME"]);
  });

  // Compose documents `VAR='Let\'s go!'`, so a reader closing on that quote takes the value's next
  // line as a declaration -- and a `NAME=` written there answers 3, which stops a deploy.
  it("takes the backslash escape inside a single-quoted value too, so one carrying it closes where compose closes it", () => {
    const file = ["ALPHA_NAME='Let\\'s go", "GAMMA_NAME=this line is data", "last line'", "BETA_NAME=plain"].join("\n");

    assert.deepEqual(scanNames(file).names, ["ALPHA_NAME", "BETA_NAME"]);
  });

  // Swallowed, this answers 0 over a file whose every later name went unread; compose refuses such
  // a file outright, so the advisory arm is the honest verdict on one.
  it("reports the line an unterminated quote opened rather than passing over the rest of the file", () => {
    const file = 'ALPHA_NAME=fine\nBETA_NAME="never closed\nGAMMA_NAME=missed\n';

    assert.deepEqual(scanNames(file), { names: ["ALPHA_NAME", "BETA_NAME"], assigned: ["ALPHA_NAME", "BETA_NAME"], unreadable: [2] });
  });

  it("reports the number of a line it cannot read rather than passing over it", () => {
    assert.deepEqual(scanNames("ALPHA_NAME=fine\n1_NOT_A_NAME=x\n").unreadable, [2]);
  });
});

describe("the names outside the schema", () => {
  it("returns a NEXT_PUBLIC_ name, which the client schema declares none of", () => {
    assert.deepEqual(undeclaredNames(["ALPHA_NAME", "NEXT_PUBLIC_THING"], DECLARED), ["NEXT_PUBLIC_THING"]);
  });
});

describe("what the deploy grades the checker's answer as", () => {
  it("answers 0 where every name in the file is one the schema declares", () => {
    const done = check("ALPHA_NAME=one\nBETA_NAME=two\n");

    assert.equal(done.status, 0, done.stderr);
    assert.equal(done.stderr, "");
  });

  it("answers 3 naming the undeclared variables, and carries no value of any of them", () => {
    const done = check("ALPHA_NAME=one\nGAMMA_NAME=a value no line may echo\n");

    assert.equal(done.status, 3, done.stderr);
    assert.match(done.stderr, /Undeclared environment variables: GAMMA_NAME/);
    assert.doesNotMatch(done.stderr, /a value no line may echo/);
  });

  // The refusal stops a deploy, so an unreadable file answers the advisory instead: every name it
  // would report is a guess about a file this reader could not take whole.
  it("answers 4 for a line it cannot read rather than refusing over the names it did read", () => {
    const done = check("GAMMA_NAME=one\n1_NOT_A_NAME=x\n");

    assert.equal(done.status, 4, done.stderr);
    assert.match(done.stderr, /cannot parse: 2/);
  });

  it("answers 4 where the declared set is not in the image, naming the error class and no path", () => {
    const done = check("ALPHA_NAME=one\n", { sets: null });

    assert.equal(done.status, 4, done.stderr);
    assert.equal(done.stderr.trim(), "Error");
  });

  // The half a file nobody edited fails: an undeclared name is a line somebody wrote, and a missing
  // required one is a line nobody did, which no reader over the file's own names can see.
  it("answers 3 naming a required variable the file never declares", () => {
    const done = check("BETA_NAME=two\n");

    assert.equal(done.status, 3, done.stderr);
    assert.match(done.stderr, /Missing required environment variables: ALPHA_NAME/);
  });

  // Both lines in one run: a remedy held back until the next one is a second visit to the host.
  it("names both kinds where the file carries one of each", () => {
    const done = check("GAMMA_NAME=two\n");

    assert.equal(done.status, 3, done.stderr);
    assert.match(done.stderr, /Undeclared environment variables: GAMMA_NAME/);
    assert.match(done.stderr, /Missing required environment variables: ALPHA_NAME/);
  });

  // The boundary of what this refusal proves: the name is declared and the value behind it stays
  // the boot gate's, which is what `docs/ops/spec.md :: I183` fixes.
  it("counts a required name whose value is empty as declared", () => {
    const done = check("ALPHA_NAME=\n");

    assert.equal(done.status, 0, done.stderr);
  });

  /* The empty value above reaches the container as an empty string; this one reaches it as nothing
     at all, compose dropping a pass-through it could not resolve. So it is the harder of the two. */
  it("refuses a required name written bare, which carries no value off this file", () => {
    const done = check("ALPHA_NAME\n");

    assert.equal(done.status, 3, done.stderr);
    assert.match(done.stderr, /Missing required environment variables: ALPHA_NAME/);
  });

  it("still reads a bare name as declared, so a typo written that way is refused as the undeclared line it is", () => {
    const done = check("ALPHA_NAME=one\nGAMMA_NAME\n");

    assert.equal(done.status, 3, done.stderr);
    assert.match(done.stderr, /Undeclared environment variables: GAMMA_NAME/);
    assert.doesNotMatch(done.stderr, /Missing required/);
  });
});

describe("the names production alone is held to", () => {
  /* The deploy has one deployment, so it asks for both sets; a file passing without the flag and
     failing with it is the whole of what the flag does. */
  it("refuses a production-only required name the file omits, under the flag the deploy passes", () => {
    const done = check("ALPHA_NAME=one\n", { flags: ["--production"] });

    assert.equal(done.status, 3, done.stderr);
    assert.match(done.stderr, /Missing required environment variables: OMEGA_NAME/);
  });

  it("demands it of nobody else, that half of the schema resting on a value this reader never opens", () => {
    const done = check("ALPHA_NAME=one\n");

    assert.equal(done.status, 0, done.stderr);
  });

  it("names both required halves in one line where the file holds neither", () => {
    const done = check("BETA_NAME=two\n", { flags: ["--production"] });

    assert.equal(done.status, 3, done.stderr);
    assert.match(done.stderr, /Missing required environment variables: ALPHA_NAME, OMEGA_NAME/);
  });
});

describe("the key set the image carries", () => {
  it("is emitted by the flags package.json holds, so a deploy reads what this build declared", async () => {
    const [command, ...flags] = MANIFEST.scripts["environment-names"].split(" ");
    const destination = path.join(SCRATCH, "emitted.json");

    assert.equal(command, "node");
    const done = spawnSync(process.execPath, [...flags, destination], { cwd: HERE, encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);

    // `pnpm test` sets it; run bare, the import below validates on a machine holding no value for
    // any of these names and refuses before the case can compare anything.
    assert.equal(process.env.SKIP_ENV_VALIDATION, "true", "run this suite through `pnpm test`, which sets SKIP_ENV_VALIDATION");

    /* Skipping validation makes `createEnv` hand back the `runtimeEnv` object itself, so these keys
       are the wiring the emitter's own route never reads: two lists that can disagree
       (`docs/_standard/standard.md :: PRE-4`). */
    const { frontend_config } = await import("./src/core/config.ts");
    const wired = Object.keys(frontend_config).sort();

    const emitted = JSON.parse(readFileSync(destination, "utf8"));

    assert.ok(wired.length >= 10, `expected the schema to declare at least 10 names, read ${String(wired.length)}`);
    assert.deepEqual(emitted.declared, wired);
    // Which names are required is derived by booting, in `fl_frontend/src/core/config.test.ts`; what
    // this asks is that the file carry each set at all, an empty one reading as a schema demanding
    // nothing.
    assert.ok(emitted.required.length > 0, "the emitted file demands no name of a host at all");
    assert.ok(emitted.productionRequired.length > 0, "the emitted file demands no name of a production host in particular");
    assert.deepEqual(
      [...emitted.required, ...emitted.productionRequired].filter((name) => !wired.includes(name)),
      [],
    );
  });

  it("is copied to the paths the checker reads when the deploy gives it none, at a mode of its own", () => {
    const emitted = /RUN pnpm run environment-names (\S+)/.exec(DOCKERFILE);
    const copied = /^COPY --from=builder(?: (--chmod=\S+))? (\/app\/\S+) (\/app\/\S+) \.\/$/m.exec(DOCKERFILE);
    const workdirs = [...DOCKERFILE.matchAll(/^WORKDIR (\S+)$/gm)].map((match) => match[1]);

    assert.ok(emitted !== null, "fl_frontend/Dockerfile runs no environment-names step");
    assert.ok(copied !== null, "fl_frontend/Dockerfile copies no unowned pair into the runner");
    // Left to the builder's umask, a 0600 pair would make every deploy an advisory forever, the
    // preflight running as the host's own user and never as the builder's.
    assert.equal(copied[1], "--chmod=644", "the reader and the key set are copied at whatever mode the builder left them");
    assert.deepEqual(new Set(workdirs), new Set(["/app"]));
    assert.deepEqual(new Set([copied[2], copied[3]]), new Set([DECLARED_NAMES_FILE, `/app/${path.basename(CHECKER)}`]));
    assert.equal(`/app/${emitted[1]}`, DECLARED_NAMES_FILE);
    assert.equal(path.posix.dirname(ENVIRONMENT_FILE), "/app");
  });
});
