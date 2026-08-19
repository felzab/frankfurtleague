import util from "node:util";

import { getRequestCorrelationId } from "./requestScope";

const LEVELS = [
  ["log", "INFO"],
  ["warn", "WARNING"],
  ["error", "ERROR"],
] as const;

function isJsonDocument(value: string): boolean {
  if (!value.startsWith("{")) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export function installConsoleShim() {
  for (const [method, level] of LEVELS) {
    console[method] = (...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "string" && isJsonDocument(args[0])) {
        process.stdout.write(args[0] + "\n");
        return;
      }

      process.stdout.write(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          service: "fl_frontend",
          correlation_id: getRequestCorrelationId() ?? "SYSTEM",
          message: util.format(...args),
          source: "console",
        }) + "\n",
      );
    };
  }
}
