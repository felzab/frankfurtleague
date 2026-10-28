import "server-only";

import { KEIN_SONDEREREIGNIS } from "./spielWerte";

import type { FLSpielAdmin } from "@/features/spiele/schemas";
import type { SpielWerte } from "./spielWerte";

/** The editor's values as a stored fixture gives them. */
export function werteOf(spiel: FLSpielAdmin): SpielWerte {
  return {
    // Both already parsed as a calendar day and a time of day by the read's schema.
    datum: spiel.datum as SpielWerte["datum"],
    uhrzeit: spiel.uhrzeit as SpielWerte["uhrzeit"],
    spielort: spiel.ort?.spielort_id ?? null,
    mietpreis: spiel.ort === null ? "" : String(spiel.ort.mietpreis),
    sonderereignis: spiel.sonderereignis ?? KEIN_SONDEREREIGNIS,
    notiz: spiel.notiz ?? "",
  };
}
