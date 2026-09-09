"use client";

import { useEffect } from "react";

/**
 * The seam is a hook: Next gives each segment its own boundary and they render no component in
 * common, so a boundary that forgets to report is silent in exactly the case reporting exists for
 * (`docs/logging/spec.md :: 1.3`).
 */
export function useReportClientCrash(error: Error & { digest?: string }): void {
  // A server error is already recorded by `instrumentation.ts`, so it is not re-reported; a CLIENT
  // crash is recorded nowhere without this.
  useEffect(() => {
    if (error.digest) return;

    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String(error.message ?? "Unknown client error").slice(0, 500),
        path: window.location.pathname.slice(0, 300),
        stack: typeof error.stack === "string" ? error.stack.slice(0, 4000) : undefined,
      }),
    }).catch(() => {});
  }, [error]);
}
