import type { ActionFailure } from "@/shared/types/types";

/** Every failure title says the change did not happen, which is false where nobody can tell. */
const OUTCOME_UNKNOWN_TITLE = "Unklar, ob es gespeichert wurde";

const OUTCOME_PARTIAL_TITLE = "Nur teilweise gespeichert";

const OUTCOME_TITLES: Readonly<Record<NonNullable<ActionFailure["outcome"]>, string>> = {
  unknown: OUTCOME_UNKNOWN_TITLE,
  partial: OUTCOME_PARTIAL_TITLE,
};

/**
 * The title a failure's toast carries: a marked outcome's own, the raising site's otherwise. Apart from
 * `fl_frontend/src/shared/utils/appToast.ts`, which suites double, so a double titles a failure as it does.
 */
export function failureToastTitle(siteTitle: string, outcome: ActionFailure["outcome"]): string {
  return outcome === undefined ? siteTitle : OUTCOME_TITLES[outcome];
}
