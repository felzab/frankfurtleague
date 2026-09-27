import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import { ACTOR_KEY_FILE } from "@/core/authDoubles.ts";
import { replacingModule } from "@/core/exportingModule.ts";

import type { TestContext } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One line the boot wrote, as the logger was handed it. */
type Line = { level: string; event: string; fields: unknown };

const lines: Line[] = [];

/** The retired variable as the doubled config answers it, which a case sets. */
let retired: string | undefined;

/** Where a refused boot's own files go, removed after the run. */
const KEY_DIRECTORY = mkdtempSync(path.join(tmpdir(), "fl-boot-key-"));
after(() => rmSync(KEY_DIRECTORY, { recursive: true, force: true }));

/** The key file the doubled config names, which a case sets; every other boot reads the run's own key. */
let keyFile = ACTOR_KEY_FILE;

// Every level records: which level the retired variable's line takes is part of what is asserted.
const record =
  (level: string) =>
  (event: string, ...rest: unknown[]): void =>
    void lines.push({ level, event, fields: rest.at(-1) });
const LOGGING_DOUBLE = {
  logger: { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") },
};

// A getter, so each case sets the variable the one registry entry reads.
const CONFIG_DOUBLE = {
  frontend_config: {
    LOG_FORMAT: "console",
    BEWERBUNG_SWEEP: "off",
    get ALLOWED_ADMIN_EMAILS() {
      return retired;
    },
    get ACTOR_SIGNING_KEY_FILE() {
      return keyFile;
    },
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts"))
      return { format: "module", source: replacingModule(url, "the logger", LOGGING_DOUBLE), shortCircuit: true };
    if (url.endsWith("/src/core/config.ts"))
      return { format: "module", source: replacingModule(url, "the config", CONFIG_DOUBLE), shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { register } = await import("./instrumentation.ts");

beforeEach(() => {
  lines.length = 0;
});

describe("the boot finding the retired administrator variable", () => {
  /* One environment file serves this image and one a rollback returns to, so the variable is taken and
     read by nothing; the line is what tells an operator the file still carries it. */
  it("warns once, naming the variable and never its value", async () => {
    const value = "vorstand@schule.de,kassenwart@schule.de";
    retired = value;

    try {
      await register();
    } finally {
      retired = undefined;
    }

    assert.deepEqual(lines, [
      { level: "WARN", event: "config.retired_variable", fields: { error_code: "FE-BOOT-002", variables: "ALLOWED_ADMIN_EMAILS" } },
    ]);
    assert.ok(!JSON.stringify(lines).includes("schule.de"), "the line carried an address the variable held");
  });

  it("writes nothing where the file no longer carries it", async () => {
    await register();

    assert.deepEqual(lines, []);
  });
});

describe("the pass announcing each change to who administers", () => {
  const MINUTE_MS = 60 * 1000;
  const env = process.env as Record<string, string | undefined>;

  /** Passes run so far: each claim fails here, which is what shows a pass ran. */
  const passes = (): number => lines.filter(({ event }) => event === "berechtigung.abgleich_failed").length;

  /** One boot under `nodeEnv`, then each step of `steps` in turn, answering the passes run after each. */
  async function bootAndStep(t: TestContext, nodeEnv: string, steps: readonly number[]): Promise<number[]> {
    const before = env.NODE_ENV;
    env.NODE_ENV = nodeEnv;
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const counted: number[] = [];
    try {
      await register();
      for (const step of steps) {
        t.mock.timers.tick(step);
        // The pass's claim and its failure settle on the queue behind the tick.
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        counted.push(passes());
      }
    } finally {
      t.mock.timers.reset();
      if (before === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = before;
    }

    return counted;
  }

  /* Never behind the application sweep's switch, which this boot has off: a local stack sets it off, and
     a change to who administers is announced wherever a production build runs. */
  it("arms under a production build whatever the application sweep's switch says", async (t) => {
    assert.deepEqual(await bootAndStep(t, "production", [MINUTE_MS]), [1], "no pass ran a minute after a production boot");
  });

  /* A minute first, as a deploy recreates this container before the backend answers; then every five
     minutes from the boot. */
  it("waits its minute, then runs every five minutes", async (t) => {
    const SEKUNDE_MS = 1000;
    const steps = [MINUTE_MS - SEKUNDE_MS, SEKUNDE_MS, 4 * MINUTE_MS - SEKUNDE_MS, SEKUNDE_MS, 5 * MINUTE_MS];

    assert.deepEqual(await bootAndStep(t, "production", steps), [0, 1, 1, 2, 3]);
  });

  it("arms nothing under a development build", async (t) => {
    assert.deepEqual(await bootAndStep(t, "development", [10 * MINUTE_MS]), [0]);
  });
});

describe("the boot reading the actor's signing key", () => {
  /**
   * The boot under `file`: what it threw, what it wrote, and the code it would have exited with. The
   * exit is recorded rather than taken, so the runner's own process lives.
   */
  async function refusedBoot(t: TestContext, file: string): Promise<{ thrown: unknown; written: string; exited: number | undefined }> {
    const chunks: string[] = [];
    let exited: number | undefined;
    const write = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
    t.mock.method(process.stdout, "write", (chunk: unknown, ...rest: unknown[]) => {
      // The runner reports each case to its parent over this stream in binary frames, and one swallowed
      // here is a case the run never counts: only text is the boot's.
      if (typeof chunk !== "string") return write(chunk, ...rest);
      // Refused past the exit: a line written after it would never reach the stream.
      assert.equal(exited, undefined, "a line was written after the process ended");
      chunks.push(chunk);
      const done = rest.at(-1);
      if (typeof done === "function") (done as () => void)();
      return true;
    });
    t.mock.method(process, "exit", () => {
      exited = Number(process.exitCode ?? 0);
    });
    keyFile = file;
    try {
      const thrown = await register().then(
        () => undefined,
        (error: unknown) => error,
      );
      return { thrown: thrown, written: chunks.join(""), exited: exited };
    } finally {
      keyFile = ACTOR_KEY_FILE;
      process.exitCode = undefined;
      t.mock.restoreAll();
    }
  }

  /* Refused before anything is served: past the boot, every signed-in page would fail its guard. */
  it("refuses to boot without the file, naming its path on a CRITICAL line and then ending the process", async (t) => {
    const missing = path.join(KEY_DIRECTORY, "absent.pem");

    const { thrown, written, exited } = await refusedBoot(t, missing);

    assert.ok(thrown instanceof Error && thrown.message.includes(missing), "the boot went on, or its error named no path");
    assert.equal(exited, 1, "the process was left serving rather than ended non-zero");
    assert.match(written, /CRITICAL/);
    assert.match(written, /FE-BOOT-003/);
    assert.ok(written.includes(missing), "the line named no path");
  });

  it("refuses to boot on a file holding no key, never writing what it holds", async (t) => {
    // One short mark repeated, so any fragment of the file seven characters long carries it whole.
    const mark = "Q7xZ";
    const held = mark.repeat(40);
    const file = path.join(KEY_DIRECTORY, "garbage.pem");
    writeFileSync(file, held);

    const { thrown, written, exited } = await refusedBoot(t, file);

    assert.ok(thrown instanceof Error, "the boot went on over a file holding no key");
    assert.equal(exited, 1, "the process was left serving rather than ended non-zero");
    assert.match(written, /FE-BOOT-003/);
    assert.ok(!written.includes(mark) && !String(thrown.stack).includes(mark), "the refusal quoted the file");
  });

  it("boots on a readable Ed25519 key, writing nothing and ending nothing", async (t) => {
    const { thrown, written, exited } = await refusedBoot(t, ACTOR_KEY_FILE);

    assert.equal(thrown, undefined);
    assert.equal(written, "");
    assert.equal(exited, undefined);
  });
});
