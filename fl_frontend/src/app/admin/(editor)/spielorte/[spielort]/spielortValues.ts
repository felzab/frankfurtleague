import type { FLSpielort } from "@/core/generated/client/types";

/**
 * What the venue editor's fields hold: its name, the address's five lines and its price, each as the text typed,
 * which the save reads as the write's own types.
 */
export type SpielortValues = {
  name: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  stadtteil: string;
  stadt: string;
  mietpreis: string;
};

/** The editor's values as a stored venue gives them. */
export function valuesOf(spielort: FLSpielort): SpielortValues {
  const { address } = spielort;
  return {
    name: spielort.name,
    strasse: address.strasse,
    hausnummer: address.hausnummer,
    plz: address.plz,
    stadtteil: address.stadtteil,
    stadt: address.stadt,
    mietpreis: String(spielort.default_mietpreis),
  };
}
