import { CONFIRMED_CHIP, RETIRED_CHIP, UNCONFIRMED_CHIP } from "@/kit/stateChips";

import type { FLSchiedsrichterAdminRow } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/**
 * The chip after a referee's name: „Stillgelegt“ once retired, else where the entry stands, as the backend serves it.
 * An entry asked and not yet answered, its link standing or lapsed, and one never asked all read as unconfirmed: the
 * hourly pass erases an unanswered entry once the midnight after its deadline has passed, so a lapsed one stands only
 * until that pass next runs.
 */
export function refereeChip(referee: Pick<FLSchiedsrichterAdminRow, "inactive_since" | "state">): ChipProps {
  if (referee.inactive_since !== null) return RETIRED_CHIP;
  switch (referee.state) {
    case "confirmed":
      return CONFIRMED_CHIP;
    case "valid":
    case "expired":
    case "unasked":
      return UNCONFIRMED_CHIP;
  }
}
