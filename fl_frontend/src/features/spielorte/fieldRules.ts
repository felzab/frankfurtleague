import "server-only";

import { requires } from "@/core/action";
import {
  SpielortePatchSpielortBody,
  spielortePatchSpielortBodyAddressCityMax,
  spielortePatchSpielortBodyAddressDistrictMax,
  spielortePatchSpielortBodyAddressHouseNumberMax,
  spielortePatchSpielortBodyAddressHouseNumberRegExp,
  spielortePatchSpielortBodyAddressPostcodeMax,
  spielortePatchSpielortBodyAddressStreetMax,
  spielortePatchSpielortBodyNameMax,
  SpielortePostSpielortBody,
  spielortePostSpielortBodyAddressCityMax,
  spielortePostSpielortBodyAddressDistrictMax,
  spielortePostSpielortBodyAddressHouseNumberMax,
  spielortePostSpielortBodyAddressHouseNumberRegExp,
  spielortePostSpielortBodyAddressPostcodeMax,
  spielortePostSpielortBodyAddressStreetMax,
  spielortePostSpielortBodyNameMax,
} from "@/core/generated/zod/inputs";

import type { AddressRules } from "@/kit/AddressFields";

/** What a venue write asks of each field, read on the server. */
export type SpielortRules = {
  required: Readonly<Record<"name" | "default_mietpreis", boolean>>;
  max: Readonly<Record<"name", number>>;
  address: AddressRules;
};

type Body = typeof SpielortePostSpielortBody | typeof SpielortePatchSpielortBody;

/** An untouched text box posts "", and the price's box sends no figure (`numberBox`). */
const requiredOf = ({ shape }: Body): SpielortRules["required"] => ({
  name: requires(shape.name, ""),
  default_mietpreis: requires(shape.default_mietpreis, null),
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

export const SPIELORT_CREATE_RULES: SpielortRules = {
  required: requiredOf(SpielortePostSpielortBody),
  max: { name: spielortePostSpielortBodyNameMax },
  address: {
    required: addressRequiredOf(SpielortePostSpielortBody),
    max: {
      street: spielortePostSpielortBodyAddressStreetMax,
      house_number: spielortePostSpielortBodyAddressHouseNumberMax,
      district: spielortePostSpielortBodyAddressDistrictMax,
      city: spielortePostSpielortBodyAddressCityMax,
    },
    postcodeLength: spielortePostSpielortBodyAddressPostcodeMax,
    pattern: { house_number: spielortePostSpielortBodyAddressHouseNumberRegExp.source },
  },
};

export const SPIELORT_SAVE_RULES: SpielortRules = {
  required: requiredOf(SpielortePatchSpielortBody),
  max: { name: spielortePatchSpielortBodyNameMax },
  address: {
    required: addressRequiredOf(SpielortePatchSpielortBody),
    max: {
      street: spielortePatchSpielortBodyAddressStreetMax,
      house_number: spielortePatchSpielortBodyAddressHouseNumberMax,
      district: spielortePatchSpielortBodyAddressDistrictMax,
      city: spielortePatchSpielortBodyAddressCityMax,
    },
    postcodeLength: spielortePatchSpielortBodyAddressPostcodeMax,
    pattern: { house_number: spielortePatchSpielortBodyAddressHouseNumberRegExp.source },
  },
};
