"use client";

import { useEffect } from "react";

import { Error } from "@/shared/components/ui/Error";

// Server errors arrive redacted to a message plus a digest and are already recorded
// by `instrumentation.ts`, so those are NOT re-reported; a CLIENT crash carries no
// digest and is recorded nowhere without this (`docs/logging/spec.md`).
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
