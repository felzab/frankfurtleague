import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";

import { DECLARED_NAMES_FILE, scanNames, undeclaredLines } from "./check-environment-names.mjs";

const FRONTEND = path.join(import.meta.dirname, "..");
const CHECKER = path.join(import.meta.dirname, "check-environment-names.mjs");
const MANIFEST = JSON.parse(readFileSync(path.join(FRONTEND, "package.json"), "utf8"));
const DOCKERFILE = readFileSync(path.join(FRONTEND, "Dockerfile"), "utf8");
const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-environment-names-"));

// Dummy names throughout, and files this suite writes itself: nothing here reads, mounts or names a
// real environment file.
const DECLARED = ["ALPHA_NAME", "BETA_NAME", "OMEGA_NAME"];
const SETS = { declared: DECLARED, required: ["ALPHA_NAME"] };

/** One run of the checker over files written for the case, answering the code the deploy grades. */
function check(contents, { sets = SETS } = {}) {
  const stem = path.join(SCRATCH, `case-${String(process.hrtime.bigint())}`);
  writeFileSync(`${stem}.environment`, contents);
  if (sets !== null) writeFileSync(`${stem}.json`, JSON.stringify(sets));

  return spawnSync(process.execPath, [CHECKER, `${stem}.environment`, `${stem}.json`], { encoding: "utf8" });
}

describe("the names read out of an environment file", () => {
  it("takes a NAME=VALUE line and neither a comment nor a blank line, carriage returns included", () => {
    const file = ["# ALPHA_NAME is set elsewhere", "", " \t", "BETA_NAME=https://example.org:8443/a?b=c", "GAMMA_NAME=\r", ""].join("\n");

    expect(scanNames(file)).toStrictEqual({ names: ["BETA_NAME", "GAMMA_NAME"], lines: { BETA_NAME: [4], GAMMA_NAME: [5] }, unreadable: [] });
  });

  // Each of these a preflight has already refused; read anyway, a name off one would be a guess. The
  // quoted value's data line keeps the shape and is read as a name, the file unreadable all the same.
  it("reports by number every line outside the one strict shape, a quoted value's opening and closing lines among them", () => {
    const file = ['ALPHA_NAME="first line', "BETA_NAME=data", 'last line"', "GAMMA_NAME", "\uFEFF"].join("\n");

    expect(scanNames(file).unreadable).toStrictEqual([1, 3, 4, 5]);
  });

  it("reports a comment holding a line break another reader takes, or a NUL byte", () => {
    const file = ["# a\rB_NAME=1", "# a\u2028B_NAME=1", "# a\u2029B_NAME=1", "# a\u0000b", "# fine"].join("\n");

    expect(scanNames(file)).toStrictEqual({ names: [], lines: {}, unreadable: [1, 2, 3, 4] });
  });
});

describe("the names outside the schema", () => {
  it("returns every line of a NEXT_PUBLIC_ name, which the client schema declares none of", () => {
    expect(undeclaredLines({ ALPHA_NAME: [1], NEXT_PUBLIC_THING: [4, 2] }, DECLARED)).toStrictEqual([2, 4]);
  });
});

describe("what the deploy grades the checker's answer as", () => {
  it("answers 4 when named no file at all, having judged nothing", () => {
    const done = spawnSync(process.execPath, [CHECKER], { encoding: "utf8" });

    expect(done.status, done.stderr).toBe(4);
    expect(done.stderr).toMatch(/no environment file named/);
  });

  it("answers 0 where every name in the file is one the schema declares", () => {
    const done = check("ALPHA_NAME=one\nBETA_NAME=two\n");

    expect(done.status, done.stderr).toBe(0);
    expect(done.stderr).toBe("");
  });

  it("answers 3 numbering the lines of the undeclared variables, and carries no value of any of them", () => {
    const done = check("ALPHA_NAME=one\nGAMMA_NAME=a-value-no-line-may-echo\n");

    expect(done.status, done.stderr).toBe(3);
    expect(done.stderr).toMatch(/Undeclared environment variables on 1 line\(s\): 2/);
    expect(done.stderr).not.toMatch(/a-value-no-line-may-echo/);
  });

  // A pasted key's line keeping the shape declares its own text as a name, so an undeclared name is
  // never printed.
  it("names no undeclared variable, a key's fragment declared as one among them", () => {
    const done = check("ALPHA_NAME=one\nKEYDATAvxq==\n");

    expect(done.status, done.stderr).toBe(3);
    expect(done.stderr).toMatch(/on 1 line\(s\): 2/);
    expect(done.stderr).not.toMatch(/vxq/);
  });

  // The refusal stops a deploy, so an unreadable file answers the advisory instead: every name it
  // would report is a guess about a file this reader could not take whole.
  it("answers 4 for a line it cannot read rather than refusing over the names it did read", () => {
    const done = check("GAMMA_NAME=one\nBETA_NAME='a value no line may echo'\n");

    expect(done.status, done.stderr).toBe(4);
    expect(done.stderr).toMatch(/cannot parse: 2/);
    expect(done.stderr).not.toMatch(/a value no line may echo/);
  });

  it("answers 4 where the declared set is not in the image, naming the error class and no path", () => {
    const done = check("ALPHA_NAME=one\n", { sets: null });

    expect(done.status, done.stderr).toBe(4);
    expect(done.stderr.trim()).toBe("Error");
  });

  // The half a file nobody edited fails: an undeclared name is a line somebody wrote, and a missing
  // required one is a line nobody did, which no reader over the file's own names can see.
  it("answers 3 naming a required variable the file never declares", () => {
    const done = check("BETA_NAME=two\n");

    expect(done.status, done.stderr).toBe(3);
    expect(done.stderr).toMatch(/Missing required environment variables: ALPHA_NAME/);
  });

  // Both lines in one run: a remedy held back until the next one is a second visit to the host.
  it("names both kinds where the file carries one of each", () => {
    const done = check("GAMMA_NAME=two\n");

    expect(done.status, done.stderr).toBe(3);
    expect(done.stderr).toMatch(/Undeclared environment variables on 1 line\(s\): 1/);
    expect(done.stderr).toMatch(/Missing required environment variables: ALPHA_NAME/);
  });

  // The boundary of what this refusal proves: the name is declared and the value behind it stays
  // the boot gate's.
  it("counts a required name whose value is empty as declared", () => {
    const done = check("ALPHA_NAME=\n");

    expect(done.status, done.stderr).toBe(0);
  });
});

describe("the key set the image carries", () => {
  it("is emitted by the flags package.json holds, so a deploy reads what this build declared", async () => {
    const [command, ...flags] = MANIFEST.scripts["environment-names"].split(" ");
    const destination = path.join(SCRATCH, "emitted.json");

    expect(command).toBe("node");
    const done = spawnSync(process.execPath, [...flags, destination], { cwd: FRONTEND, encoding: "utf8" });
    expect(done.status, done.stderr).toBe(0);

    // `vitest.config.mts` sets it; run bare, the import below validates on a machine holding no value
    // for any of these names and refuses before the case can compare anything.
    expect(process.env.SKIP_ENV_VALIDATION, "run this suite through Vitest, whose config sets SKIP_ENV_VALIDATION").toBe("true");

    /* Skipping validation hands back the input itself, so the settings' keys are the schema's own keys
       less the secrets'. */
    const { frontend_config } = await import("../src/core/config.ts");
    const wired = Object.keys(frontend_config).sort();

    const emitted = JSON.parse(readFileSync(destination, "utf8"));

    assert.ok(wired.length >= 8, `expected the schema to wire at least 8 settings, read ${String(wired.length)}`);
    // What this asks is that the file carry the required set at all, an empty one reading as a schema
    // demanding nothing.
    assert.ok(emitted.required.length > 0, "the emitted file demands no name of a host at all");
    expect(emitted.required.filter((name) => !wired.includes(name))).toStrictEqual([]);
  });

  it("is copied to the path the checker reads when the deploy names no key set, at a mode of its own", () => {
    const emitted = /RUN pnpm run environment-names (\S+)/.exec(DOCKERFILE);
    const copied = /^COPY --from=builder(?: (--chmod=\S+))? (\/app\/\S+) (\/app\/\S+) \.\/$/m.exec(DOCKERFILE);
    const workdirs = [...DOCKERFILE.matchAll(/^WORKDIR (\S+)$/gm)].map((match) => match[1]);

    assert.ok(emitted !== null, "fl_frontend/Dockerfile runs no environment-names step");
    assert.ok(copied !== null, "fl_frontend/Dockerfile copies no unowned pair into the runner");
    // Left to the builder's umask, a 0600 pair would make every deploy an advisory forever, the
    // preflight running as the host's own user and never as the builder's.
    expect(copied[1], "the reader and the key set are copied at whatever mode the builder left them").toBe("--chmod=644");
    expect(new Set(workdirs)).toStrictEqual(new Set(["/app"]));
    // Its source path in the builder; the `./` destination lands it at `/app/` in the runner, the path
    // `scripts/tests/test_deploy_env_names.py` holds to what the deploy runs.
    const builderChecker = `/app/${path.relative(FRONTEND, CHECKER).split(path.sep).join("/")}`;
    expect(new Set([copied[2], copied[3]])).toStrictEqual(new Set([DECLARED_NAMES_FILE, builderChecker]));
    expect(`/app/${emitted[1]}`).toBe(DECLARED_NAMES_FILE);
  });
});
