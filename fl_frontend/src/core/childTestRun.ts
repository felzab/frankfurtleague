import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Long enough for a child that ends promptly, short enough that one held open by a skipped cleanup fails rather than stalls. */
const CHILD_TIMEOUT_MS = 60_000;

const ALIAS_HOOK = pathToFileURL(path.join(import.meta.dirname, "..", "..", "scripts", "tsconfig-alias-hook.mjs")).href;

/** How a child's run ended: its exit code, everything it wrote, and whether it outlived the timeout. */
export type ChildTestRun = { status: number | null; output: string; timedOut: boolean };

/**
 * For a failure no case can observe of itself: a file's hook, or its process's end. A fixture names
 * modules through `@/`, which the child's alias hook resolves, so no path of this machine is written
 * into it.
 */
export function runAsTestFile(source: string): ChildTestRun {
  const scratch = mkdtempSync(path.join(tmpdir(), "fl-child-run-"));
  const fixture = path.join(scratch, "fixture.test.mjs");
  writeFileSync(fixture, source);
  // Without `NODE_TEST_CONTEXT`, under which a child refuses to run a file, and without the gate's
  // shard, which `NODE_OPTIONS` carries and which leaves a one-file child no file.
  const env = { ...process.env, NODE_OPTIONS: (process.env.NODE_OPTIONS ?? "").replace(/--test-shard=\S+/g, "") };
  Reflect.deleteProperty(env, "NODE_TEST_CONTEXT");
  try {
    const run = spawnSync(process.execPath, ["--import", ALIAS_HOOK, "--test", "--test-reporter=spec", fixture], {
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
      env,
    });
    return { status: run.status, output: `${run.stdout}${run.stderr}`, timedOut: run.error !== undefined };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
