import type { FLSchiedsrichter } from "@/core/generated/client/types";

/**
 * What the referee editor's fields hold: the name and the school, the address and the phone, and the fee, each as
 * the text typed, an absent value an empty box, which the save reads as the write's own types.
 */
export type SchiedsrichterValues = {
  name: string;
  schule: string;
  email: string;
  phone: string;
  default_payment: string;
};

export function valuesOf(referee: FLSchiedsrichter): SchiedsrichterValues {
  return {
    name: referee.name ?? "",
    schule: referee.schule ?? "",
    email: referee.kontakt.email ?? "",
    phone: referee.kontakt.phone ?? "",
    default_payment: String(referee.default_payment),
  };
}
