import type { FLSchiedsrichter } from "@/core/generated/client/types";

/**
 * What the referee editor's fields hold: the name and the school, the address and the phone, and the fee, each as
 * the text typed, an absent value an empty box, which the save reads as the write's own types.
 */
export type SchiedsrichterValues = {
  name: string;
  schule: string;
  email: string;
  telefon: string;
  honorar: string;
};

/** The editor's values as a stored referee gives them. */
export function valuesOf(referee: FLSchiedsrichter): SchiedsrichterValues {
  return {
    name: referee.name ?? "",
    schule: referee.schule ?? "",
    email: referee.kontakt.email ?? "",
    telefon: referee.kontakt.telefon ?? "",
    honorar: String(referee.default_payment),
  };
}
