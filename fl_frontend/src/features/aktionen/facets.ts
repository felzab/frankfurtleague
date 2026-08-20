import { AKTION_COLLECTION_LABELS, AKTION_OPERATION_LABELS } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminAktionRow } from "./types";

// Derived from the label maps rather than spelled a second time: an area or an operation added there
// has to reach this filter, and two hand-kept lists drift the moment one of them grows.
const toOptions = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

// Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
// key on the array's identity.
export const AKTIONEN_FACETS: readonly Facet<AdminAktionRow>[] = [
  {
    param: "bereich",
    label: "Bereich",
    options: toOptions(AKTION_COLLECTION_LABELS),
    read: (aktion) => [aktion.collection],
  },
  {
    param: "art",
    label: "Art",
    options: toOptions(AKTION_OPERATION_LABELS),
    read: (aktion) => [aktion.operation],
  },
  {
    param: "herkunft",
    label: "Herkunft",
    options: [
      { value: "person", label: "Angemeldete Person" },
      { value: "system", label: "System" },
    ],
    // On the actor's `kind` and never on the address: the system actor's is a sentinel rather than a
    // mailbox, and a later scheme that verifies an identity records a different kind under the same one.
    read: (aktion) => [aktion.actor.kind === "system" ? "system" : "person"],
  },
];
