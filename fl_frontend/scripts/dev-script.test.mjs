import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// The frontend's directory, where `pnpm dev` runs the script and resolves its paths.
const FRONTEND = path.join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const DEV_SCRIPT = JSON.parse(readFileSync(path.join(FRONTEND, "package.json"), "utf8")).scripts.dev;
// The `dev` script's dotenv-cli arguments, from its first flag to the `--` handing over to Next.
const LOADER = DEV_SCRIPT.split(" dotenv ")[1]?.split(" -- ")[0]?.split(" ") ?? [];
const ROOT_FILE = LOADER.includes("-e") ? LOADER[LOADER.indexOf("-e") + 1] : undefined;

// Plain `.txt` files of dummy names: nothing here reads, writes or names an environment file.
const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-dev-script-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

// Next's own loader, as `next dev` runs it over `fl_frontend/.env`, handed that file's text rather
// than a file: it keeps a name the process started with, so this prints what reaches the server.
const NEXT_READS = `
const { processEnv } = require(${JSON.stringify(createRequire(require.resolve("next/package.json")).resolve("@next/env"))});
processEnv([{ path: ".env", contents: "FL_DEV_PROBE_ROOT=from-the-package-file\\nFL_DEV_PROBE_PACKAGE=from-the-package-file\\n" }], ".");
const { FL_DEV_PROBE_ROOT, FL_DEV_PROBE_PACKAGE, FL_DEV_PROBE_SHELL } = process.env;
process.stdout.write(JSON.stringify({ FL_DEV_PROBE_ROOT, FL_DEV_PROBE_PACKAGE, FL_DEV_PROBE_SHELL }));
`;

/** What the dev server's environment holds for the probes, started by the `dev` script's loader over `root`. */
function served(root) {
  // Refused before any spawn: without `-e`, dotenv-cli reads the working directory's `.env` instead.
  assert.notEqual(ROOT_FILE, undefined, `the dev script names no root file: ${DEV_SCRIPT}`);
  const flags = LOADER.map((flag) => (flag === ROOT_FILE ? root : flag));
  const said = execFileSync(process.execPath, [require.resolve("dotenv-cli/cli.js"), ...flags, "--", process.execPath, "-e", NEXT_READS], {
    // The scratch directory, which holds no `.env`, and a bound: a flag misread as the command would
    // otherwise be handed to the shell to open.
    cwd: SCRATCH,
    env: { ...process.env, FL_DEV_PROBE_SHELL: "from-the-shell" },
    encoding: "utf8",
    timeout: 30_000,
  });
  return JSON.parse(said);
}

describe("the dev script's loader", () => {
  it("reads the checkout root's .env, beside the compose file that lists it for both containers", () => {
    assert.equal(path.basename(ROOT_FILE ?? ""), ".env");
    assert.ok(existsSync(path.join(path.resolve(FRONTEND, path.dirname(ROOT_FILE)), "docker-compose.yml")), DEV_SCRIPT);
  });

  it("starts Next with no flag letting the file override the shell", () => {
    assert.ok(!LOADER.includes("-o") && !LOADER.includes("--override"), DEV_SCRIPT);
    assert.match(DEV_SCRIPT, / -- next dev( |$)/);
  });

  it("hands the server the shell's value, then the root file's, then fl_frontend/.env's", () => {
    const root = path.join(SCRATCH, "root.txt");
    writeFileSync(root, "FL_DEV_PROBE_ROOT=from-the-root-file\nFL_DEV_PROBE_SHELL=from-the-root-file\n");

    assert.deepEqual(served(root), {
      FL_DEV_PROBE_ROOT: "from-the-root-file",
      FL_DEV_PROBE_PACKAGE: "from-the-package-file",
      FL_DEV_PROBE_SHELL: "from-the-shell",
    });
  });

  it("starts on a machine with no root file, the boot gate naming whatever is then missing", () => {
    assert.equal(served(path.join(SCRATCH, "absent.txt")).FL_DEV_PROBE_ROOT, "from-the-package-file");
  });
});
