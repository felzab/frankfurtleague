import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import { ACTOR_KEY_FILE } from "@/core/authDoubles.ts";
import { registerDoubles } from "@/core/exportingModule.ts";

import type { TestContext } from "node:test";

/** One line the boot wrote, as the logger was handed it. */
type Line = { level: string; event: string; fields: unknown };

const lines: Line[] = [];

/** Where a refused boot's own files go, removed after the run. */
const KEY_DIRECTORY = mkdtempSync(path.join(tmpdir(), "fl-boot-key-"));
after(() => rmSync(KEY_DIRECTORY, { recursive: true, force: true }));

/** The key file the doubled config names, which a case sets; every other boot reads the run's own key. */
let keyFile = ACTOR_KEY_FILE;

// Every level records, so a case counting a line never rests on the level its writer chose.
const record =
  (level: string) =>
  (event: string, ...rest: unknown[]): void =>
    void lines.push({ level, event, fields: rest.at(-1) });
const LOGGING_DOUBLE = {
  logger: { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") },
};

// A getter, so each case sets what the one registry entry reads.
const CONFIG_DOUBLE = {
  frontend_config: {
    LOG_FORMAT: "console",
    BEWERBUNG_SWEEP: "off",
    get ACTOR_SIGNING_KEY_FILE() {
      return keyFile;
    },
  },
};

/** How often a boot asked for the sign-in store's indexes. */
let indexBuilds = 0;

// A build that never settles, standing in for a store that never answers: a boot awaiting it never ends.
const INDEXES_DOUBLE = {
  buildAuthIndexes: () => {
    indexBuilds += 1;
    return new Promise(() => undefined);
  },
};

registerDoubles({
  modules: {
    "core/logging.ts": LOGGING_DOUBLE,
    "core/config.ts": CONFIG_DOUBLE,
    "core/authIndexes.ts": INDEXES_DOUBLE,
  },
});

const { register } = await import("./instrumentation.ts");

beforeEach(() => {
  lines.length = 0;
});

describe("a boot with nothing to report", () => {
  /* Every line a boot writes is one an operator reads in the container log, so a line written on every
     clean boot buries the one that matters. */
  it("writes no log line", async () => {
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

describe("the boot building the sign-in store's indexes (`docs/frontend/spec.md :: I498`)", () => {
  const env = process.env as Record<string, string | undefined>;

  /** One boot under `nodeEnv`: whether it finished while its build never settled, and the builds it asked for. */
  async function boot(nodeEnv: string): Promise<{ booted: boolean; builds: number }> {
    const before = env.NODE_ENV;
    env.NODE_ENV = nodeEnv;
    indexBuilds = 0;
    try {
      const outcome = await Promise.race([
        register().then(() => "booted"),
        new Promise((resolve) => setTimeout(resolve, 2000, "held").unref()),
      ]);
      return { booted: outcome === "booted", builds: indexBuilds };
    } finally {
      if (before === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = before;
    }
  }

  it("asks for them under a production build and serves without waiting for them", async () => {
    assert.deepEqual(await boot("production"), { booted: true, builds: 1 });
  });

  // `next dev` reaches a developer's own store, whose indexes are that developer's.
  it("asks for nothing under a development build", async () => {
    assert.deepEqual(await boot("development"), { booted: true, builds: 0 });
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
    assert.equal(exited, 3, "the process was left serving, or ended on a fault's code rather than a refusal's");
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
    assert.equal(exited, 3, "the process was left serving, or ended on a fault's code rather than a refusal's");
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

/* The real modules in a process of their own, as `scripts/lib/_lib.sh :: check_frontend_boot_config` runs
   the image: the exit code is the whole of what the deploy reads, and only a process that ends has one. */
describe("the boot the deploy's preflight runs, and the code it ends on", () => {
  const FRONTEND_DIR = path.join(import.meta.dirname, "..");

  // `package.json :: scripts`' own way of running a server module outside Next: `server-only` resolves
  // to the module that throws without the condition, and Node reads no `@/` alias without the hook.
  const NODE_FLAGS = [
    "--conditions=react-server",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--import",
    "./scripts/tsconfig-alias-hook.mjs",
  ];

  // Next catches the hook's rejection and serves on, so this does too: the code read is the boot's own.
  // A hook that returns is one Next goes on to serve behind, which the last line says.
  const BOOT = [
    'const { register } = await import("./src/instrumentation.ts");',
    "await register().catch(() => undefined);",
    'process.stdout.write("serving\\n");',
  ].join("\n");

  /** A production host's settings, of values nobody could mistake for real ones. */
  const SETTINGS: Readonly<Record<string, string>> = {
    APP_ENV: "production",
    API_URL: "http://backend:8000",
    API_VERSION: "0",
    AUTH_URL: "https://frankfurtleague.de",
    LOG_FORMAT: "json",
    TURNSTILE_SITE_KEY: "fabricated-site-key",
  };

  // Production's whole set, each value one the schema takes, so a case changes exactly the file it is about.
  const SIGN_IN_SECRET = "fabricated-not-a-credential-xxxx";
  const FILES: Readonly<Record<string, string>> = {
    frontend_mongodb_uri: "mongodb://mongo:27017/?directConnection=true",
    auth_secret: SIGN_IN_SECRET,
    auth_resend_key: "resend-probe",
    resend_webhook_secret: "whsec_probe",
    internal_api_key_base: "b".repeat(64),
    internal_api_key_system: "s".repeat(64),
    internal_api_key_admin: "a".repeat(64),
    turnstile_secret_key: "fabricated-turnstile-secret",
  };

  type Case = {
    settings?: Record<string, string | undefined>;
    files?: Record<string, string | undefined>;
    checkedAs?: string;
  };

  /** One boot in a process of its own: its exit code, and everything it wrote. */
  function boot({ settings = {}, files = {}, checkedAs = "production" }: Case): {
    code: number | null;
    said: string;
  } {
    const secrets = mkdtempSync(path.join(KEY_DIRECTORY, "secrets-"));
    for (const [name, content] of Object.entries({ ...FILES, ...files })) {
      if (content !== undefined) writeFileSync(path.join(secrets, name), content);
    }

    // Built rather than inherited, so no variable of the runner's own, `SKIP_ENV_VALIDATION` above all,
    // decides a case. Not production, under which a hook left returning would arm the sweeps and never end.
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", SECRETS_DIR: secrets, ACTOR_SIGNING_KEY_FILE: ACTOR_KEY_FILE };
    for (const name of ["PATH", "Path", "SystemRoot"]) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
    for (const [name, value] of Object.entries({ ...SETTINGS, ...settings })) if (value !== undefined) environment[name] = value;
    if (checkedAs !== "") environment.BOOT_CHECK = checkedAs;

    const done = spawnSync(process.execPath, [...NODE_FLAGS, "--input-type=module", "-e", BOOT], {
      cwd: FRONTEND_DIR,
      env: environment,
      encoding: "utf8",
    });

    return { code: done.status, said: `${done.stdout}${done.stderr}` };
  }

  /** The one refusal a boot wrote: the code it ended on, and its CRITICAL documents' codes and names. */
  function refused(setup: Case): { code: number | null; lines: string[] } {
    const { code, said } = boot(setup);
    const lines = said
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((document) => document.level === "CRITICAL")
      .map((document) => `${String(document.error_code)} ${String(document.variables ?? document.files ?? document.path)}`);

    return { code, lines };
  }

  it("ends on 0 having written nothing, where every gate passes", () => {
    assert.deepEqual(boot({}), { code: 0, said: "" });
  });

  // The local stack holds none of production's own files, and its preflight names its own deployment.
  it("ends on 0 for the local stack's deployment, which production's files are not demanded of", () => {
    const local = boot({
      settings: { APP_ENV: "local" },
      files: { auth_resend_key: undefined, resend_webhook_secret: undefined, turnstile_secret_key: undefined },
      checkedAs: "local",
    });

    assert.deepEqual(local, { code: 0, said: "" });
  });

  /* The schema demands production's files on `APP_ENV`'s word alone, so a production host whose file says
     `local` would pass with none of them and its bot check on the published test secret. */
  it("refuses with 3 a deployment its APP_ENV does not name, judging the files that deployment is held to", () => {
    const production = { files: { turnstile_secret_key: undefined }, settings: { APP_ENV: "local" } };

    assert.deepEqual(refused(production), { code: 3, lines: ["FE-BOOT-001 APP_ENV"] });
    assert.deepEqual(refused({ ...production, checkedAs: "local" }), { code: 0, lines: [] });
  });

  /* The process's environment carries names of the platform's own beside the file's, so no boot can tell a
     typo from them: `fl_frontend/scripts/check-environment-names.mjs` reads the file itself for that. */
  it("boots past a name nothing declares", () => {
    assert.deepEqual(boot({ settings: { TURNSTILE_SITEKEY: "a typo of a declared name" } }), { code: 0, said: "" });
  });

  // A refusal is one code wherever the boot runs, so a restarting container reads alike under either.
  it("ends a serving boot's refusal on 3 too", () => {
    assert.equal(boot({ files: { auth_secret: undefined }, checkedAs: "" }).code, 3);
  });
});
