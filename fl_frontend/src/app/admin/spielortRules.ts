import "server-only";

import { requires } from "@/core/action";
import {
  SpielortePatchSpielortBody,
  spielortePatchSpielortBodyAddressCityMax,
  spielortePatchSpielortBodyAddressDistrictMax,
  spielortePatchSpielortBodyAddressHouseNumberMax,
  spielortePatchSpielortBodyAddressPostcodeMax,
  spielortePatchSpielortBodyAddressStreetMax,
  spielortePatchSpielortBodyNameMax,
  SpielortePostSpielortBody,
  spielortePostSpielortBodyAddressCityMax,
  spielortePostSpielortBodyAddressDistrictMax,
  spielortePostSpielortBodyAddressHouseNumberMax,
  spielortePostSpielortBodyAddressPostcodeMax,
  spielortePostSpielortBodyAddressStreetMax,
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
    street: requires(address.street, ""),
    house_number: requires(address.house_number, ""),
    postcode: requires(address.postcode, ""),
    district: requires(address.district, ""),
    city: requires(address.city, ""),
  };
};

/** The create's rules, which the dialog over the venue list and over the match editor holds its boxes to. */
export const SPIELORT_RULES: SpielortRules = {
  required: requiredOf(SpielortePostSpielortBody),
  nameMax: spielortePostSpielortBodyNameMax,
  address: {
    required: addressRequiredOf(SpielortePostSpielortBody),
    maxLength: {
      street: spielortePostSpielortBodyAddressStreetMax,
      house_number: spielortePostSpielortBodyAddressHouseNumberMax,
      district: spielortePostSpielortBodyAddressDistrictMax,
      city: spielortePostSpielortBodyAddressCityMax,
    },
    postcodeLength: spielortePostSpielortBodyAddressPostcodeMax,
  },
};

/** The save's rules, which the venue editor holds its boxes to. */
export const SPIELORT_SAVE_RULES: SpielortRules = {
  required: requiredOf(SpielortePatchSpielortBody),
  nameMax: spielortePatchSpielortBodyNameMax,
  address: {
    required: addressRequiredOf(SpielortePatchSpielortBody),
    maxLength: {
      street: spielortePatchSpielortBodyAddressStreetMax,
      house_number: spielortePatchSpielortBodyAddressHouseNumberMax,
      district: spielortePatchSpielortBodyAddressDistrictMax,
      city: spielortePatchSpielortBodyAddressCityMax,
    },
    postcodeLength: spielortePatchSpielortBodyAddressPostcodeMax,
  },
};
