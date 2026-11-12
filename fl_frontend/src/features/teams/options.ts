import { COPY } from "@/core/copy";
import { FLSchulform } from "@/core/generated/client/types";
import { TRIKOT_FARBEN } from "@/core/trikotFarben";

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
    return full && gruppe !== own ? { ...option, isDisabled: true, note: COPY.admin.team.gruppeFull } : option;
  });

/**
 * The kit colours in their sheet's order, each one `taken` closed, as the public form closes it: a season's colour is
 * one team's, and the write refuses a second. The empty entry stays open, a club without a colour taking none.
 */
export const trikotOptions = (taken: readonly string[]): readonly Option[] => [
  NONE,
  ...TRIKOT_FARBEN.map(({ value, label }) => {
    const option = { id: value, label: { record: label } };
    return taken.includes(value) ? { ...option, isDisabled: true } : option;
  }),
];
