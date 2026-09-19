import type { Facet } from "@/shared/utils/facets";
import type { FLSchiedsrichter } from "./schemas";

type SchiedsrichterAngabe = "kontakt" | "ohne_kontakt" | "schule";

/** Listed with their labels rather than derived, so `read` below and this list are one closed set to the compiler. */
const ANGABEN_OPTIONS: readonly { value: SchiedsrichterAngabe; label: string }[] = [
  { value: "kontakt", label: "Mit Kontakt" },
  { value: "ohne_kontakt", label: "Ohne Kontakt" },
  { value: "schule", label: "Mit Schule" },
];

// Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
// key on the array's identity.
export const SCHIEDSRICHTER_FACETS: readonly Facet<FLSchiedsrichter>[] = [
  {
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    read: (schiedsrichter) => [schiedsrichter.inactive_since === null ? "aktiv" : "stillgelegt"],
  },
  {
    param: "angaben",
    label: "Angaben",
    options: ANGABEN_OPTIONS,
    read: (schiedsrichter): SchiedsrichterAngabe[] => {
      const held: SchiedsrichterAngabe[] = [];
      // `kontakt` is required to be present and never to be filled in, so a referee with neither a
      // phone number nor an email address is a normal document and a real gap.
      const hasKontakt = schiedsrichter.kontakt.email !== null || schiedsrichter.kontakt.telefon !== null;
      held.push(hasKontakt ? "kontakt" : "ohne_kontakt");
      if (schiedsrichter.schule !== null) held.push("schule");
      return held;
    },
  },
];
