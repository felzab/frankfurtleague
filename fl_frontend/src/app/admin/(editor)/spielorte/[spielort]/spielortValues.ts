import type { FLSpielort } from "@/core/generated/client/types";

/**
 * What the venue editor's fields hold: its name, the address's five lines and its price, each as the text typed,
 * which the save reads as the write's own types.
 */
export type SpielortValues = {
  name: string;
  street: string;
  house_number: string;
  postcode: string;
  district: string;
  city: string;
  mietpreis: string;
};

export function valuesOf(spielort: FLSpielort): SpielortValues {
  const { address } = spielort;
  return {
    name: spielort.name,
    street: address.street,
    house_number: address.house_number,
    postcode: address.postcode,
    district: address.district,
    city: address.city,
    mietpreis: String(spielort.default_mietpreis),
  };
}
