import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { loadRootEnv, ROOT_ENV_FILE } from "./next-dev.mjs";

const HERE = import.meta.dirname;
// Files this suite writes itself, of dummy names: nothing here reads or names a real environment file.
const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-next-dev-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** `name` set to `value` in this process for the length of `run`, and its earlier state put back. */
function withVariable(name, value, run) {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

function envFile(contents) {
  const file = path.join(SCRATCH, `case-${String(process.hrtime.bigint())}.env`);
  writeFileSync(file, contents);
  return file;
}

describe("the dev launcher's root file", () => {
  it("is the checkout root's .env, beside the compose file that lists it for both containers", () => {
    const root = path.resolve(HERE, path.dirname(ROOT_ENV_FILE));

    assert.equal(path.basename(ROOT_ENV_FILE), ".env");
    assert.ok(existsSync(path.join(root, "docker-compose.yml")), `${root} holds no docker-compose.yml`);
  });

  it("hands the process a name only the root file holds", () => {
    const file = envFile("FL_NEXT_DEV_PROBE=from-the-root-file\n");

    withVariable("FL_NEXT_DEV_PROBE", undefined, () => {
      loadRootEnv(file);
      assert.equal(process.env.FL_NEXT_DEV_PROBE, "from-the-root-file");
    });
  });

  it("leaves a variable already set as it was, so the shell outranks the file as it does under compose", () => {
    const file = envFile("FL_NEXT_DEV_PROBE=from-the-root-file\n");

    withVariable("FL_NEXT_DEV_PROBE", "from-the-shell", () => {
      loadRootEnv(file);
      assert.equal(process.env.FL_NEXT_DEV_PROBE, "from-the-shell");
    });
  });

  it("starts on a machine with no root file, the boot gate naming whatever is then missing", () => {
    assert.doesNotThrow(() => loadRootEnv(path.join(SCRATCH, "absent.env")));
  });
});
