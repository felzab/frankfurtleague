"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

import { DashboardError } from "./DashboardError";

/**
 * The shared body of `fl_frontend/src/app/admin/error.tsx` and
 * `fl_frontend/src/app/dashboard/error.tsx`. Next's file convention requires a file per segment, so
 * both route files exist and only the implementation is shared.
 */
// No console.error here -- see the note in `fl_frontend/src/app/error.tsx`.
export function DashboardErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  const handleRetry = () => {
    startTransition(() => {
      router.refresh();
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
