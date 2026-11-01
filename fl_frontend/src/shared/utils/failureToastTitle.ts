import type { ActionFailure } from "@/shared/types/types";

/** Every failure title says the change did not happen, which is false where nobody can tell. */
const OUTCOME_UNKNOWN_TITLE = "Unklar, ob es gespeichert wurde";

const OUTCOME_PARTIAL_TITLE = "Nur teilweise gespeichert";

const OUTCOME_TITLES: Readonly<Record<NonNullable<ActionFailure["outcome"]>, string>> = {
  unknown: OUTCOME_UNKNOWN_TITLE,
  partial: OUTCOME_PARTIAL_TITLE,
};

/**
 * A failure toast's title: a site's own title for an unknown outcome where its press saves nothing, a send's;
 * a marked outcome's own; the site's otherwise. Apart from `fl_frontend/src/shared/utils/appToast.ts`, which
 * suites double.
 */
export function failureToastTitle(siteTitle: string, outcome: ActionFailure["outcome"], unclearTitle?: string): string {
  if (outcome === "unknown" && unclearTitle !== undefined) return unclearTitle;
  return outcome === undefined ? siteTitle : OUTCOME_TITLES[outcome];
}
