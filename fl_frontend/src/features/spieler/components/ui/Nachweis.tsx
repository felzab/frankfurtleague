import { beschreibeNachweis } from "@/features/spieler/nachweis";

import type { FLEinwilligungEvidence } from "@/core/generated/client/types";
import type { Bestaetigung } from "@/features/spieler/nachweis";

/**
 * The act a choice stands on, under its value. One component for every admin readout of a consent choice, the
 * pupil's, the referee's and a contact seat's, each handing it its record's confirmation.
 */
export function Beleg({ evidence, bestaetigung }: { evidence: FLEinwilligungEvidence | null; bestaetigung: Bestaetigung }) {
  return <span className="block muted-meta">{beschreibeNachweis(evidence, bestaetigung)}</span>;
}
