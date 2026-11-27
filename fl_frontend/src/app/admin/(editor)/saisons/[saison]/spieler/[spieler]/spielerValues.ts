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

/**
 * The boxes a save needs filled that are empty, by the editor's field names, judged on the person's values with the
 * editor's changes over them: the write takes a birthdate, so an emptied one is required. The editor's draft holds the
 * same values, so the browser's pass asks the same.
 */
export const requiredOf = ({
  birth_date,
}: Readonly<Pick<Record<keyof SpielerValues, unknown>, "birth_date">>): readonly (keyof SpielerValues)[] =>
  birth_date === null || birth_date === "" ? ["birth_date"] : [];
