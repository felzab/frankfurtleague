"use client";

import { useEffect } from "react";

import { asCaughtError } from "@/shared/utils/caughtError";
import { postClientError } from "@/shared/utils/clientError";

/**
 * The seam is a hook: Next gives each segment its own boundary and they render no component in
 * common, so a boundary that forgets to report is silent in exactly the case reporting exists for.
 */
export function useReportClientCrash(thrown: unknown): void {
  // A server error is already recorded by `instrumentation.ts`, so it is not re-reported; a CLIENT
  // crash is recorded nowhere without this. Keyed on the value as thrown and normalised inside: an
  // `Error` built from a thrown non-Error during render is a new object on every render, and the
  // retry press re-renders the boundary.
  useEffect(() => {
    const error = asCaughtError(thrown);
    if (error.digest) return;

    postClientError(String(error.message ?? "Unknown client error"), typeof error.stack === "string" ? error.stack : undefined);
  }, [thrown]);
}
