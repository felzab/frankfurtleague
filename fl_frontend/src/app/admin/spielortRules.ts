import "server-only";

import { requires } from "@/core/action";
import {
  SpielortePatchSpielortBody,
  spielortePatchSpielortBodyAddressHausnummerMax,
  spielortePatchSpielortBodyAddressStadtMax,
  spielortePatchSpielortBodyAddressStadtteilMax,
  spielortePatchSpielortBodyAddressStrasseMax,
  spielortePatchSpielortBodyNameMax,
  SpielortePostSpielortBody,
  spielortePostSpielortBodyAddressHausnummerMax,
  spielortePostSpielortBodyAddressStadtMax,
  spielortePostSpielortBodyAddressStadtteilMax,
  spielortePostSpielortBodyAddressStrasseMax,
  spielortePostSpielortBodyNameMax,
} from "@/core/generated/zod/inputs";

/** The fields of a venue, by the names its create dialog and its editor post. */
type SpielortField = "name" | "strasse" | "hausnummer" | "plz" | "stadtteil" | "stadt" | "mietpreis";

/** What a venue write asks of each field, read on the server so its schema never reaches the browser. */
export type SpielortRules = { required: Readonly<Record<SpielortField, boolean>>; maxLength: Readonly<Partial<Record<SpielortField, number>>> };

type Body = typeof SpielortePostSpielortBody | typeof SpielortePatchSpielortBody;

/** An untouched text box posts "", and the price's box sends no figure (`numberBox`). */
const requiredOf = ({ shape }: Body): SpielortRules["required"] => {
  const address = shape.address.shape;
  return {
    name: requires(shape.name, ""),
    strasse: requires(address.strasse, ""),
    hausnummer: requires(address.hausnummer, ""),
    plz: requires(address.plz, ""),
    stadtteil: requires(address.stadtteil, ""),
    stadt: requires(address.stadt, ""),
    mietpreis: requires(shape.default_mietpreis, null),
  };
};

/** The create's rules, which the dialog over the venue list and over the match editor holds its boxes to. */
export const SPIELORT_RULES: SpielortRules = {
  required: requiredOf(SpielortePostSpielortBody),
  maxLength: {
    name: spielortePostSpielortBodyNameMax,
    strasse: spielortePostSpielortBodyAddressStrasseMax,
    hausnummer: spielortePostSpielortBodyAddressHausnummerMax,
    stadtteil: spielortePostSpielortBodyAddressStadtteilMax,
    stadt: spielortePostSpielortBodyAddressStadtMax,
  },
};

/** The save's rules, which the venue editor holds its boxes to. */
export const SPIELORT_SAVE_RULES: SpielortRules = {
  required: requiredOf(SpielortePatchSpielortBody),
  maxLength: {
    name: spielortePatchSpielortBodyNameMax,
    strasse: spielortePatchSpielortBodyAddressStrasseMax,
    hausnummer: spielortePatchSpielortBodyAddressHausnummerMax,
    stadtteil: spielortePatchSpielortBodyAddressStadtteilMax,
    stadt: spielortePatchSpielortBodyAddressStadtMax,
  },
};
