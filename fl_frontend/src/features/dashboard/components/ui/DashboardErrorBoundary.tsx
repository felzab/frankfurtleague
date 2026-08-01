"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

import { DashboardError } from "./DashboardError";

/**
 * The shared body of `app/admin/error.tsx` and `app/dashboard/error.tsx`, which were identical but
 * for the function name — 2 differing lines out of 58 (R2 §3.7). Next's file convention requires a
 * file per segment, so both route files still exist; only the implementation is shared.
 */
// No console.error here -- see the note in src/app/error.tsx.
export function DashboardErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  const handleRetry = () => {
    startTransition(() => {
      // 1. Force Next.js to clear the router cache and re-fetch the server data
      router.refresh();
      // 2. Clear the error boundary UI so the fresh data can render
      reset();
    });
  };

  return (
    <DashboardError
      error={error}
      retry={handleRetry}
    />
  );
}
