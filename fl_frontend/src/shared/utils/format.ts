import type { FLAddress } from "../schemas";

export function formatAddress(address?: FLAddress): string {
  if (!address) return "Keine Adresse hinterlegt";

  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadt} (${address.stadtteil})`;
}
