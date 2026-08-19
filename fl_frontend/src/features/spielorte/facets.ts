import type { Facet } from "@/shared/utils/facets";
import type { FLSpielort } from "./schemas";

// Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
// key on the array's identity.
export const SPIELORT_FACETS: readonly Facet<FLSpielort>[] = [
  {
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    read: (ort) => [ort.inactive_since === null ? "aktiv" : "stillgelegt"],
  },
  {
    param: "miete",
    label: "Mietpreis",
    options: [
      { value: "kostenlos", label: "Kostenlos" },
      { value: "bis_100", label: "Bis 100 €" },
      { value: "ueber_100", label: "Über 100 €" },
    ],
    // Exclusive and exhaustive over a non-negative integer, so the band counts add up to the list. A
    // Spiel's `mietpreis` is a point-in-time copy and deliberately not what this reads.
    read: (ort) => {
      if (ort.default_mietpreis === 0) return ["kostenlos"];
      return ort.default_mietpreis <= 100 ? ["bis_100"] : ["ueber_100"];
    },
  },
];
