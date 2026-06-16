import { frontend_config } from "./config";

export const logger = {
  info: (message: string, meta?: Record<string, any>) => log("INFO", message, meta),
  warn: (message: string, meta?: Record<string, any>) => log("WARN", message, meta),
  error: (message: string, error?: unknown, meta?: Record<string, any>) => log("ERROR", message, { error, ...meta }),
};

function log(level: "INFO" | "WARN" | "ERROR", message: string, meta?: Record<string, any>) {
  // If we are in production and requested JSON, format it exactly like FastAPI!
  if (frontend_config.LOG_FORMAT === "json") {
    const jsonLog = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    });

    if (level === "ERROR") console.error(jsonLog);
    else if (level === "WARN") console.warn(jsonLog);
    else console.log(jsonLog);

    return;
  }

  // Otherwise, use a beautiful, colorful local console format
  const color = level === "ERROR" ? "\x1b[31m" : level === "WARN" ? "\x1b[33m" : "\x1b[34m";
  const reset = "\x1b[0m";

  const traceStr = meta?.traceId ? `<${meta.traceId}> ` : "";
  const metaStr = meta ? `\n  Meta: ${JSON.stringify(meta)}` : "";

  const logStr = `${color}[${level}]${reset} ${traceStr}${message}${metaStr}`;

  if (level === "ERROR") console.error(logStr);
  else if (level === "WARN") console.warn(logStr);
  else console.log(logStr);
}
