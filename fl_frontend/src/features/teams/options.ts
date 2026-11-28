import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { FLSchulform } from "@/core/generated/client/types";
import { trikotFarbeOptions } from "@/core/trikotFarben";

import type { FLGruppenNames, FLTeamGruppeOffer } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";

/** The empty box's entry: a club need name neither, and a value the record lacks stays choosable again. */
const NONE: Option = { id: "", label: COPY.shared.notProvided };

export const schulformOptions = (): readonly Option[] => [
  NONE,
  ...Object.values(FLSchulform).map((id) => ({ id, label: COPY.team.schulformOption[id] })),
];

/**
 * A season's groups, a full one closed with its note; `own`, the group a club stands in, stays open, the club's own row
 * filling it being no reason to close it.
 */
export const gruppeOptions = (offers: readonly FLTeamGruppeOffer[], own: FLGruppenNames | null): readonly Option[] =>
  offers.map(({ gruppe, full }) => {
    const option = { id: gruppe, label: COPY.shared.season.gruppe(gruppe) };
    return full && gruppe !== own ? { ...option, isDisabled: true, note: ADMIN_COPY.team.gruppeFull } : option;
  });

/**
 * The kit colours as the public form lists them, after the empty entry, which stays open and has no swatch: a club
 * without a colour takes none.
 */
export const trikotOptions = (taken: readonly string[]): readonly Option[] => [NONE, ...trikotFarbeOptions(taken)];
