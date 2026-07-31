import { frontend_config } from "./config";

export interface LogMeta extends Record<string, unknown> {
  traceId?: string;
  error?: unknown;
  url?: string;
  endpoint?: string;
  isTimeout?: boolean;
}

export const logger = {
  info: (message: string, meta?: LogMeta) => log("INFO", message, meta),
  warn: (message: string, meta?: LogMeta) => log("WARN", message, meta),
  error: (message: string, error?: unknown, meta?: LogMeta) => log("ERROR", message, { error, ...meta }),
};

function log(level: "INFO" | "WARN" | "ERROR", message: string, meta?: LogMeta) {
  // Production
  if (frontend_config.LOG_FORMAT === "json") {
    const formattedMeta = { ...meta };
    if (meta?.error instanceof Error) {
      formattedMeta.error = {
        message: meta.error.message,
        stack: meta.error.stack,
        name: meta.error.name,
      };
    }

    const jsonLog = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...formattedMeta,
    });

    if (level === "ERROR") console.error(jsonLog);
    else if (level === "WARN") console.warn(jsonLog);
    else console.log(jsonLog);

    return;
  }

  // Development
  const color = level === "ERROR" ? "\x1b[31m" : level === "WARN" ? "\x1b[33m" : "\x1b[34m";
  const reset = "\x1b[0m";

  const traceStr = meta?.traceId ? `<${meta.traceId}> ` : "";
  const metaStr = meta ? `\n  Meta: ${JSON.stringify(meta)}` : "";

  const logStr = `${color}[${level}]${reset} ${traceStr}${message}${metaStr}`;

  if (level === "ERROR") console.error(logStr);
  else if (level === "WARN") console.warn(logStr);
  else console.log(logStr);
}
