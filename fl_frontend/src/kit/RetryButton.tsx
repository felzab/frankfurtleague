"use client";

import { useTransition } from "react";

import { Button } from "./Button";

import type { Copy } from "@/core/copy";

/**
 * An error card's retry, busy until the failed part is drawn again or fails again. Next's `retry` refreshes the route
 * inside a transition of its own, and React gives every transition started in one press the same lane, so the pending
 * flag holds until that refresh commits. A client module of its own, since the status card stands in Server Components.
 */
export function RetryButton({ label, retry }: { label: Copy; retry: () => void }) {
  const [isRetrying, startRetry] = useTransition();
  return (
    <Button
      variant="primary"
      label={label}
      isBusy={isRetrying}
      onPress={() => startRetry(retry)}
    />
  );
}
