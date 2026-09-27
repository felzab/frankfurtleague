import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One line the boot wrote, as the logger was handed it. */
type Line = { level: string; event: string; fields: unknown };

const lines: Line[] = [];

const recorders = globalThis as unknown as Record<string, unknown>;
recorders.__flBootLines = lines;

// Every level records: which level the retired variable's line takes is part of what is asserted.
const LOGGING_DOUBLE = `const record = (level) => (event, ...rest) => globalThis.__flBootLines.push({ level, event, fields: rest.at(-1) });
export const logger = { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") };`;

// A getter, so each case sets the variable the one registry entry reads.
const CONFIG_DOUBLE = `export const frontend_config = {
  LOG_FORMAT: "console",
  BEWERBUNG_SWEEP: "off",
  get ALLOWED_ADMIN_EMAILS() { return globalThis.__flBootRetired; },
};`;

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
    recorders.__flBootRetired = value;

    try {
      await register();
    } finally {
      delete recorders.__flBootRetired;
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
