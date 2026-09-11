"use client";

import { BackButton } from "@/shared/components/ui/BackButton";

/**
 * The club page's own exit, which is where its two page-specific facts sit: the list a cold entry
 * lands on, and that the page already spaces its sections with `gap-y-8`, so the pill adds nothing.
 */
export function TeamDetailsBackButton() {
  return (
    <BackButton
      fallbackHref="/dashboard/teams"
      spacing="mb-0"
    />
  );
}
