import { Console } from "node:console";
import { Writable } from "node:stream";
import util from "node:util";

import { frontend_config } from "./config";
import { logger } from "./logging";

import type { LogLevel } from "./logFormat";

const SOURCE = { source: "console" } as const;

// A code of the shim's own rather than a caller's: what arrives here — Next's `⨯ Error` dumps among
// it — has no call site of ours to take one from, and a failure line carries one
// (`docs/logging/spec.md` §1.2).
const FORWARDED_FAILURE = { error_code: "FE-CONSOLE-001", ...SOURCE } as const;

// Through the logger rather than a second envelope: a dependency's `console.debug` then falls
// under the same `LOG_LEVEL` threshold as the app's own lines.
const WRITERS: Record<Exclude<LogLevel, "CRITICAL">, (message: string) => void> = {
  DEBUG: (message) => logger.debug(message, SOURCE),
  INFO: (message) => logger.info(message, SOURCE),
  WARNING: (message) => logger.warn(message, FORWARDED_FAILURE),
  ERROR: (message) => logger.error(message, undefined, FORWARDED_FAILURE),
};

// The five methods that carry a level of their own.
const LEVELLED = [
  ["debug", "DEBUG"],
  ["log", "INFO"],
  ["info", "INFO"],
  ["warn", "WARNING"],
  ["error", "ERROR"],
] as const;

const LEVELLED_NAMES: ReadonlySet<string> = new Set(LEVELLED.map(([method]) => method));

function isJsonDocument(value: string): boolean {
  if (!value.startsWith("{")) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

// The level of the stream Node would have written to: a `trace` or a failed `assert` goes to
// stderr, everything else to stdout.
function sink(level: "INFO" | "ERROR"): Writable {
  return new Writable({
    write(chunk: unknown, _encoding, callback) {
      // One document per console call: Node hands the whole formatted text -- a table, a stack --
      // as one chunk, and the trailing newline is the stream's rather than the message's.
      WRITERS[level](String(chunk).replace(/\n$/, ""));
      callback();
    },
  });
}

function delegate<K extends keyof Console>(method: K, inner: Console): void {
  console[method] = inner[method];
}

export function installConsoleShim() {
  // Under the console format the logger's own line leaves through `console.*`, so a shim there
  // would wrap the very writer it forwards to; the json branch writes to stdout directly.
  if (frontend_config.LOG_FORMAT !== "json") return;

  for (const [method, level] of LEVELLED) {
    console[method] = (...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "string" && isJsonDocument(args[0])) {
        process.stdout.write(args[0] + "\n");
        return;
      }

      WRITERS[level](util.format(...args));
    };
  }

  // Every other writing method keeps Node's own semantics -- a `count`'s counter, a `time`'s
  // clock -- by delegating to a `Console` over the two sinks above.
  const inner = new Console({ stdout: sink("INFO"), stderr: sink("ERROR") });
  // Read off the instance rather than listed: Node binds each method as an own property, so a
  // method a later Node adds is covered too. `timeStamp`, `profile` and `profileEnd` reach the
  // inspector alone and write nothing.
  for (const method of Object.keys(inner) as (keyof Console)[]) {
    if (!LEVELLED_NAMES.has(method) && typeof inner[method] === "function") delegate(method, inner);
  }
}
