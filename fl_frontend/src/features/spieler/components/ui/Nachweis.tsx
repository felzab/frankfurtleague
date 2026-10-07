import { beschreibeNachweis } from "@/features/spieler/nachweis";
import { Leer } from "@/shared/components/ui/Angabe";

import type { FLEinwilligungNachweis } from "@/features/spieler/schemas";

/**
 * The act a choice stands on, under its value: the confirmation's day and label are another act's. One
 * component for every admin readout of a consent choice, the pupil's, the referee's and a contact seat's.
 */
export function Beleg({
  nachweis,
  bestaetigtAm,
  textVersion,
}: {
  nachweis: FLEinwilligungNachweis | null;
  bestaetigtAm: string | null;
  textVersion: string | null;
}) {
  return <span className="block muted-meta">{beschreibeNachweis(nachweis, bestaetigtAm, textVersion)}</span>;
}

/**
 * A stored label names a label of the backend's registry, so one the registry does not hold is a
 * record citing words nobody can produce, and a bare key renders the two alike.
 */
export function Fassung({ textVersion, istBekannt }: { textVersion: string | null; istBekannt: boolean | null }) {
  if (textVersion === null) return <Leer />;

  // `null` where the registry's read failed: the key stands, and the check says it was not made.
  if (istBekannt === null) {
    return (
      <>
        {textVersion} <Leer>Nicht geprüft</Leer>
      </>
    );
  }

  // Beside the key rather than instead of it: whoever repairs the mismatch needs the key that
  // resolved to nothing.
  if (!istBekannt) {
    return (
      <>
        {textVersion} <Leer>Unbekannte Fassung</Leer>
      </>
    );
  }

  return textVersion;
}
