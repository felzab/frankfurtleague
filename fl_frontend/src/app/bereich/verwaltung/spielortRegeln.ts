import "server-only";

import {
  SpielortePostSpielortBody,
  spielortePostSpielortBodyAddressHausnummerMax,
  spielortePostSpielortBodyAddressStadtMax,
  spielortePostSpielortBodyAddressStadtteilMax,
  spielortePostSpielortBodyAddressStrasseMax,
} from "@/core/generated/zod/inputs";

/** The fields of a new venue, by the names its form posts. */
export type SpielortFeld = "name" | "strasse" | "hausnummer" | "plz" | "stadtteil" | "stadt" | "mietpreis";

/** What the create's write asks of each field, read on the server so its schema never reaches the browser. */
export type SpielortRegeln = { pflicht: Readonly<Record<SpielortFeld, boolean>>; hoechstens: Readonly<Partial<Record<SpielortFeld, number>>> };

const { shape } = SpielortePostSpielortBody;
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
    strasse: spielortePostSpielortBodyAddressStrasseMax,
    hausnummer: spielortePostSpielortBodyAddressHausnummerMax,
    stadtteil: spielortePostSpielortBodyAddressStadtteilMax,
    stadt: spielortePostSpielortBodyAddressStadtMax,
  },
};
