"use client";

import { useEffect } from "react";

import { Error } from "@/shared/components/ui/Error";

// Server errors arrive here redacted by Next to a message plus a digest, and are already recorded
// server-side by instrumentation.ts -- so those are NOT re-reported. A CLIENT crash (no digest) is
// recorded nowhere without this: the structured logger is server-only, so the boundary posts the
// crash to /api/client-error, the one route that turns a browser-side failure into a log line
// (docs/logging.md). Fire-and-forget: reporting must never be able to crash the error page itself.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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

  return (
    <Error
      error={error}
      reset={reset}
    />
  );
}
