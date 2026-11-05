import "server-only";

import {
  SpielortePostSpielortBody,
  spielortePostSpielortBodyAddressHausnummerMax,
  spielortePostSpielortBodyAddressStadtMax,
  spielortePostSpielortBodyAddressStadtteilMax,
  spielortePostSpielortBodyAddressStrasseMax,
} from "@/core/generated/zod/inputs";

/** The fields of a new venue, by the names its form posts. */
export type SpielortField = "name" | "strasse" | "hausnummer" | "plz" | "stadtteil" | "stadt" | "mietpreis";

/** What the create's write asks of each field, read on the server so its schema never reaches the browser. */
export type SpielortRules = { required: Readonly<Record<SpielortField, boolean>>; maxLength: Readonly<Partial<Record<SpielortField, number>>> };

const { shape } = SpielortePostSpielortBody;
const address = shape.address.shape;

/** A field is required where the write refuses it empty: an untouched text box posts "", an untouched figure nothing. */
const required = (field: { safeParse: (value: unknown) => { success: boolean } }, empty: "" | null) => !field.safeParse(empty).success;

export const SPIELORT_RULES: SpielortRules = {
  required: {
    name: required(shape.name, ""),
    strasse: required(address.strasse, ""),
    hausnummer: required(address.hausnummer, ""),
    plz: required(address.plz, ""),
    stadtteil: required(address.stadtteil, ""),
    stadt: required(address.stadt, ""),
    mietpreis: required(shape.default_mietpreis, null),
  },
  maxLength: {
    strasse: spielortePostSpielortBodyAddressStrasseMax,
    hausnummer: spielortePostSpielortBodyAddressHausnummerMax,
    stadtteil: spielortePostSpielortBodyAddressStadtteilMax,
    stadt: spielortePostSpielortBodyAddressStadtMax,
  },
};
