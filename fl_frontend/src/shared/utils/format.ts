import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLAddress } from "../schemas";

export function formatAddress(address?: FLAddress): string {
  if (!address) return "Keine Adresse hinterlegt";

  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadt} (${address.stadtteil})`;
}

export function formatAddressFull(address: FLAddress): string {
  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadtteil ?? ""} ${address.stadt}, Deutschland`;
}

export function formatMapsLink(ort: FLSpielort) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ort.name}, ${formatAddressFull(ort.address)}`)}`;
}
