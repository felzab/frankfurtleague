import { COPY } from "@/core/copy/shared";
import { FLSpielerPosition, FLSpielerRolle } from "@/core/generated/client/types";

import { orderStufen } from "./constants";

import type { FLSpielerStufe } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";

/** The empty box, which the write reads as no value. */
const NONE: Option = { id: "", label: COPY.shared.notProvided };

/**
 * The positions alone, for the pupil's own form, which opens empty as its other optional selects do: „Nicht hinterlegt“
 * words a record's missing fact for whoever keeps the record, not a choice a pupil makes.
 */
export const positionChoices = (): readonly Option[] =>
  Object.values(FLSpielerPosition).map((position) => ({ id: position, label: { record: position } }));

export const positionOptions = (): readonly Option[] => [NONE, ...positionChoices()];

/**
 * A season's levels in the league's order, and `held`, a level the row holds that the season stopped offering, which
 * the write still takes for that row; alone, as `positionChoices` is, for the pupil's own form.
 */
export const stufeChoices = (allowed: readonly FLSpielerStufe[], held: FLSpielerStufe | null = null): readonly Option[] =>
  orderStufen([...allowed, ...(held === null ? [] : [held])]).map((stufe) => ({ id: stufe, label: { record: stufe } }));

export const stufeOptions = (allowed: readonly FLSpielerStufe[], held: FLSpielerStufe | null = null): readonly Option[] => [
  NONE,
  ...stufeChoices(allowed, held),
];

/** The two roles, each another live row of the squad holds closed with its note, as the write refuses a second holder. */
export const rolleOptions = (taken: readonly FLSpielerRolle[]): readonly Option[] => [
  NONE,
  ...Object.values(FLSpielerRolle).map((rolle): Option => {
    const option = { id: rolle, label: COPY.kader.rolleOption[rolle] };
    return taken.includes(rolle) ? { ...option, isDisabled: true, note: COPY.shared.field.taken } : option;
  }),
];
