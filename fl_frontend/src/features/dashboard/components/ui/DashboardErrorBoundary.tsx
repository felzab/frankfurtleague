"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { DashboardError } from "./DashboardError";

/**
 * The shared body of `fl_frontend/src/app/admin/error.tsx` and
 * `fl_frontend/src/app/dashboard/error.tsx`. Next's file convention requires a file per segment, so
 * both route files exist and only the implementation is shared.
 */
// No console.error here: Next has already redacted a server error to a message plus a digest,
// and a client crash is in the browser's own console and posted by `useReportClientCrash`.
export function DashboardErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  // `useTransition` rather than the bare `startTransition`: without the flag a slow re-fetch reports
  // nothing and invites a second press, and nothing ends react-aria's hover on a tree the router keeps.
  const [isRetrying, startRetrying] = useTransition();

  useReportClientCrash(error);

  const handleRetry = () => {
    startRetrying(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <DashboardError
      error={error}
      retry={handleRetry}
      isRetrying={isRetrying}
    />
  );
}
