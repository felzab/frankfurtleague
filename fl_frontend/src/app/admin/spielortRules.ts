import "server-only";

import { requires } from "@/core/action";
import {
  SpielortePatchSpielortBody,
  spielortePatchSpielortBodyAddressHausnummerMax,
  spielortePatchSpielortBodyAddressPlzMax,
  spielortePatchSpielortBodyAddressStadtMax,
  spielortePatchSpielortBodyAddressStadtteilMax,
  spielortePatchSpielortBodyAddressStrasseMax,
  spielortePatchSpielortBodyNameMax,
  SpielortePostSpielortBody,
  spielortePostSpielortBodyAddressHausnummerMax,
  spielortePostSpielortBodyAddressPlzMax,
  spielortePostSpielortBodyAddressStadtMax,
  spielortePostSpielortBodyAddressStadtteilMax,
  spielortePostSpielortBodyAddressStrasseMax,
  spielortePostSpielortBodyNameMax,
} from "@/core/generated/zod/inputs";

import type { AddressRules } from "@/kit/AddressFields";

/** What a venue write asks of each field, read on the server so its schema never reaches the browser. */
export type SpielortRules = {
  required: Readonly<Record<"name" | "mietpreis", boolean>>;
  nameMax: number;
  address: AddressRules;
};

type Body = typeof SpielortePostSpielortBody | typeof SpielortePatchSpielortBody;

/** An untouched text box posts "", and the price's box sends no figure (`numberBox`). */
const requiredOf = ({ shape }: Body): SpielortRules["required"] => ({
  name: requires(shape.name, ""),
  mietpreis: requires(shape.default_mietpreis, null),
});

const addressRequiredOf = ({ shape }: Body): AddressRules["required"] => {
  const address = shape.address.shape;
  return {
    strasse: requires(address.strasse, ""),
    hausnummer: requires(address.hausnummer, ""),
    plz: requires(address.plz, ""),
    stadtteil: requires(address.stadtteil, ""),
    stadt: requires(address.stadt, ""),
  };
};

/** The create's rules, which the dialog over the venue list and over the match editor holds its boxes to. */
export const SPIELORT_RULES: SpielortRules = {
  required: requiredOf(SpielortePostSpielortBody),
  nameMax: spielortePostSpielortBodyNameMax,
  address: {
    required: addressRequiredOf(SpielortePostSpielortBody),
    maxLength: {
      strasse: spielortePostSpielortBodyAddressStrasseMax,
      hausnummer: spielortePostSpielortBodyAddressHausnummerMax,
      stadtteil: spielortePostSpielortBodyAddressStadtteilMax,
      stadt: spielortePostSpielortBodyAddressStadtMax,
    },
    plzLength: spielortePostSpielortBodyAddressPlzMax,
  },
};

/** The save's rules, which the venue editor holds its boxes to. */
export const SPIELORT_SAVE_RULES: SpielortRules = {
  required: requiredOf(SpielortePatchSpielortBody),
  nameMax: spielortePatchSpielortBodyNameMax,
  address: {
    required: addressRequiredOf(SpielortePatchSpielortBody),
    maxLength: {
      strasse: spielortePatchSpielortBodyAddressStrasseMax,
      hausnummer: spielortePatchSpielortBodyAddressHausnummerMax,
      stadtteil: spielortePatchSpielortBodyAddressStadtteilMax,
      stadt: spielortePatchSpielortBodyAddressStadtMax,
    },
    plzLength: spielortePatchSpielortBodyAddressPlzMax,
  },
};
