import type { FLSpielerSaisonAdminResponse } from "@/core/generated/client/types";

/**
 * What the Spieler editor's fields hold: the person's two names and their birthdate, and the squad row's four, each as
 * typed or chosen, an absent value an empty box, which the save reads as the write's own types.
 */
export type SpielerValues = {
  first_name: string;
  last_name: string;
  birth_date: string | null;
  nummer: string;
  position: string;
  stufe: string;
  rolle: string;
};

/** The editor's values as the read gives them. */
export function valuesOf({ person, kader }: FLSpielerSaisonAdminResponse): SpielerValues {
  return {
    first_name: person.first_name,
    last_name: person.last_name ?? "",
    birth_date: person.birth_date,
    nummer: kader.nummer ?? "",
    position: kader.position ?? "",
    stufe: kader.stufe ?? "",
    rolle: kader.rolle ?? "",
  };
}
