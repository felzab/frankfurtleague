import { CONFIRMED_CHIP, OBJECTED_CHIP, RETIRED_CHIP, UNCONFIRMED_CHIP } from "@/kit/stateChips";

import type { FLSchiedsrichter } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/**
 * Where a referee's entry stands, as the administration reads it: confirmed, with a consent on record; objected through
 * their link, the entry going when the link lapses; asked and not yet answered; or never asked, a retired entry whose
 * corrected address no link has gone to. An unanswered entry also goes when its link lapses: the hourly pass erases it
 * once the midnight after its deadline has passed, so an expired one stands only until that pass next runs.
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

/**
 * The chip after a referee's name, the list's „Stand“ column's and the editor's head alike: „Stillgelegt“ once retired,
 * else where the entry stands.
 */
export function refereeChip(referee: Pick<FLSchiedsrichter, "inactive_since" | "einwilligung" | "confirmation">): ChipProps {
  if (referee.inactive_since !== null) return RETIRED_CHIP;
  switch (confirmationStateOf(referee)) {
    case "confirmed":
      return CONFIRMED_CHIP;
    case "objected":
      return OBJECTED_CHIP;
    case "unanswered":
    case "unasked":
      return UNCONFIRMED_CHIP;
  }
}
