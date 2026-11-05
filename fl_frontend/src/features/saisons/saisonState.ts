import "server-only";

import { SERVER_COPY } from "@/core/serverCopy";

import type { FLSaisonAdmin } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

const STATE = SERVER_COPY.landing.saison.state;

/**
 * Where a season stands, in the landing's one vocabulary, so a season reads alike on the public card and in the
 * administration: planned before its start, running from it. Which season the site shows is a fact of its own, the
 * activation box's, never a state word.
 */
export function saisonChipOf(saison: Pick<FLSaisonAdmin, "begun">): ChipProps {
  return saison.begun ? { tone: "success", label: STATE.running } : { tone: "info", label: STATE.planned };
}
