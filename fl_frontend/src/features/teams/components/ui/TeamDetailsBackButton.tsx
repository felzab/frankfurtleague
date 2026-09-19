"use client";

import { BackButton } from "@/shared/components/ui/BackButton";
import { withSaisonId } from "@/shared/utils/saisonHref";

/**
 * The club page's own exit, which is where its two page-specific facts sit: the list a cold entry
 * lands on, and that the page already spaces its sections with `gap-y-8`, so the pill adds nothing.
 */
export function TeamDetailsBackButton({ saisonId }: { saisonId: string | undefined }) {
  return (
    <BackButton
      // The season the page shows, or a cold entry on a past season's club lands on the running season's list.
      fallbackHref={withSaisonId("/dashboard/teams", saisonId)}
      spacing="mb-0"
    />
  );
}
