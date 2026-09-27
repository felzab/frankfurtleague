import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { exportingModule } from "@/core/exportingModule.ts";

import type { TestContext } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One line the boot wrote, as the logger was handed it. */
type Line = { level: string; event: string; fields: unknown };

const lines: Line[] = [];

/** The retired variable as the doubled config answers it, which a case sets. */
let retired: string | undefined;

// Every level records: which level the retired variable's line takes is part of what is asserted.
const record =
  (level: string) =>
  (event: string, ...rest: unknown[]): void =>
    void lines.push({ level, event, fields: rest.at(-1) });
const LOGGING_DOUBLE = exportingModule({
  logger: { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") },
});

// A getter, so each case sets the variable the one registry entry reads.
const CONFIG_DOUBLE = exportingModule({
  frontend_config: {
    LOG_FORMAT: "console",
    BEWERBUNG_SWEEP: "off",
    get ALLOWED_ADMIN_EMAILS() {
      return retired;
    },
  },
});

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
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

  /** One boot under `nodeEnv`, and the first pass's minute: the claim fails here, which is what shows it ran. */
  async function bootAndWait(t: TestContext, nodeEnv: string): Promise<string[]> {
    const before = env.NODE_ENV;
    env.NODE_ENV = nodeEnv;
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    try {
      await register();
      t.mock.timers.tick(MINUTE_MS);
      // The pass's claim and its failure settle on the queue behind the tick.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      t.mock.timers.reset();
      if (before === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = before;
    }

    return lines.map(({ event }) => event);
  }

  /* Never behind the application sweep's switch, which this boot has off: a local stack sets it off, and
     a change to who administers is announced wherever a production build runs. */
  it("arms under a production build whatever the application sweep's switch says", async (t) => {
    assert.ok((await bootAndWait(t, "production")).includes("berechtigung.abgleich_failed"), "no pass ran a minute after a production boot");
  });

  it("arms nothing under a development build", async (t) => {
    assert.deepEqual(await bootAndWait(t, "development"), []);
  });
});
