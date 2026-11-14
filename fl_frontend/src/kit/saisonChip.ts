import { SERVER_COPY } from "@/core/serverCopy";

import type { ChipProps } from "./Chip";

const STATE = SERVER_COPY.saisonState;

/**
 * Where a season stands, the one chip every page naming the state draws, the landing's card and the administration
 * alike: grey before its start, blue while it runs and green once its places are decided, Carbon's not-started,
 * in-progress and done, each apart from the others by its hue.
 */
export const SAISON_CHIP = {
  planned: { tone: "neutral", label: STATE.planned },
  running: { tone: "info", label: STATE.running },
  decided: { tone: "success", label: STATE.decided },
} as const satisfies Record<keyof typeof STATE, ChipProps>;
