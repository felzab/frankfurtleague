import "server-only";

import { FLPostSpielortPayloadSchema } from "@/features/spielorte/schemas";
import {
  ADDRESS_HAUSNUMMER_MAX_LENGTH,
  ADDRESS_STADT_MAX_LENGTH,
  ADDRESS_STADTTEIL_MAX_LENGTH,
  ADDRESS_STRASSE_MAX_LENGTH,
} from "@/shared/schemas";

/** The fields of a new venue, by the names its form posts. */
export type SpielortFeld = "name" | "strasse" | "hausnummer" | "plz" | "stadtteil" | "stadt" | "mietpreis";

/** What the create's write asks of each field, read on the server so its schema never reaches the browser. */
export type SpielortRegeln = { pflicht: Readonly<Record<SpielortFeld, boolean>>; hoechstens: Readonly<Partial<Record<SpielortFeld, number>>> };

const { shape } = FLPostSpielortPayloadSchema;
const adresse = shape.address.shape;

/** A field is required where the write refuses it empty: an untouched text box posts "", an untouched figure nothing. */
const pflicht = (feld: { safeParse: (wert: unknown) => { success: boolean } }, leer: "" | null) => !feld.safeParse(leer).success;

export const SPIELORT_REGELN: SpielortRegeln = {
  pflicht: {
    name: pflicht(shape.name, ""),
    strasse: pflicht(adresse.strasse, ""),
    hausnummer: pflicht(adresse.hausnummer, ""),
    plz: pflicht(adresse.plz, ""),
    stadtteil: pflicht(adresse.stadtteil, ""),
    stadt: pflicht(adresse.stadt, ""),
    mietpreis: pflicht(shape.default_mietpreis, null),
  },
  hoechstens: {
    strasse: ADDRESS_STRASSE_MAX_LENGTH,
    hausnummer: ADDRESS_HAUSNUMMER_MAX_LENGTH,
    stadtteil: ADDRESS_STADTTEIL_MAX_LENGTH,
    stadt: ADDRESS_STADT_MAX_LENGTH,
  },
};
