import { COPY } from "@/core/copy";
import { FLSpielerPosition, FLSpielerRolle } from "@/core/generated/client/types";

import { orderStufen } from "./constants";

import type { FLSpielerStufe } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";

/**
 * A squad row's three choices as every form offers them, the team's Kader dialog, the pupil's registration and the
 * administration's player editor alike, each opening on the empty box the write reads as no value.
 */

const NONE: Option = { id: "", label: COPY.shared.notProvided };

/** The positions a pupil may play, in the published order. */
export const positionOptions = (): readonly Option[] => [
  NONE,
  ...Object.values(FLSpielerPosition).map((position) => ({ id: position, label: { record: position } })),
];

/**
 * A season's levels in the league's order, and `held`, a level the row holds that the season stopped offering, which
 * the write still takes for that row.
 */
export const stufeOptions = (allowed: readonly FLSpielerStufe[], held: FLSpielerStufe | null = null): readonly Option[] => [
  NONE,
  ...orderStufen([...allowed, ...(held === null ? [] : [held])]).map((stufe) => ({ id: stufe, label: COPY.admin.saison.stufe[stufe] })),
];

/** The two roles, each another live row of the squad holds closed with its note, as the write refuses a second holder. */
export const rolleOptions = (taken: readonly FLSpielerRolle[]): readonly Option[] => [
  NONE,
  ...Object.values(FLSpielerRolle).map((rolle): Option => {
    const option = { id: rolle, label: COPY.admin.spieler.rolleOption[rolle] };
    return taken.includes(rolle) ? { ...option, isDisabled: true, note: COPY.shared.field.taken } : option;
  }),
];
