import type { FLTeamAddress } from "@/features/teams/types";

export const typedObjectEntries = <T extends object>(obj: T) => {
  return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
};

export function formatAddress(address?: FLTeamAddress): string {
  if (!address) return "Keine Adresse hinterlegt";

  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadt} (${address.stadtteil})`;
}
