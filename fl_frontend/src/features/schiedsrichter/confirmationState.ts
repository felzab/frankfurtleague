import type { FLSchiedsrichter } from "@/core/generated/client/types";

/**
 * Where a referee's entry stands, as the administration reads it: confirmed, with a consent on record; objected
 * through their link, the entry going when the link lapses; asked and not yet answered; or never asked, a retired
 * entry whose corrected address no link has gone to. An unanswered entry also goes when its link lapses: the hourly
 * pass erases it once the midnight after its deadline has passed (`fl_backend/app/api/schiedsrichter/services.py ::
 * ERASE_AT_FIELD`), so an expired one stands only until that pass next runs.
 */
export type ConfirmationState = "confirmed" | "objected" | "unanswered" | "unasked";

export function confirmationStateOf({
  einwilligung,
  confirmation,
}: Pick<FLSchiedsrichter, "einwilligung" | "confirmation">): ConfirmationState {
  if (einwilligung !== null) return "confirmed";
  if (confirmation === null) return "unasked";
  return confirmation.declined_at === null ? "unanswered" : "objected";
}
