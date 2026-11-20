"use client";

import { useEffect } from "react";

import { postClientError } from "@/shared/utils/clientError";

/**
 * The seam is a hook: Next gives each segment its own boundary and they render no component in
 * common, so a boundary that forgets to report is silent in exactly the case reporting exists for.
 */
export function useReportClientCrash(thrown: unknown): void {
  // A server error is already recorded by the server's instrumentation, so it is not re-reported; a client
  // crash is recorded nowhere without this. Keyed on the value as thrown and normalised inside: an
  // `Error` built from a thrown non-Error during render is a new object on every render, and the
  // retry press re-renders the boundary.
  useEffect(() => {
    const error: Error & { digest?: string } = thrown instanceof Error ? thrown : new Error(String(thrown));
    if (error.digest) return;

    postClientError(error.message, typeof error.stack === "string" ? error.stack : undefined);
  }, [thrown]);
}
