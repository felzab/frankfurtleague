import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { KeinTag } from "@/features/spieler/components/ui/Nachweis";
import { Angabe } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLBewerbungZustellung } from "@/shared/schemas";
import type { ReactNode } from "react";

/** Beside the deadline rather than among the delivery facts, which say what became of the message. */
const LINK_ABGELAUFEN_LABEL = "abgelaufen";

/**
 * One confirmation link's sent day, deadline and delivery, as every administrator editor showing a
 * link reads them out, so one state is one word on each.
 */
export function LinkStandAngaben({
  verschicktAm,
  frist,
  istAbgelaufen,
  zustellung,
  vorZustellung,
}: {
  verschicktAm: string;
  frist: string;
  /** The read's judgement of the deadline, never this browser's day; false where a lapse costs nothing. */
  istAbgelaufen: boolean;
  zustellung: FLBewerbungZustellung | null;
  /** A fact of the caller's own between the deadline and the delivery. */
  vorZustellung?: ReactNode;
}) {
  const chip = zustellung === null ? null : ZUSTELLUNG_CHIP[zustellung.stand];

  return (
    <>
      <Angabe label="Link gesendet am">{formatSpielDatum(verschicktAm)}</Angabe>
      <Angabe label="Gültig bis">
        {formatSpielDatum(frist)}
        {istAbgelaufen && <span className={`${labelBadge("warning")} ms-2 h-7 shrink-0`}>{LINK_ABGELAUFEN_LABEL}</span>}
      </Angabe>
      {vorZustellung}
      <Angabe label="Zustellung">
        {/* `null` covers accepted and delivered alike: the chip exists for what an administrator can
            act on, and the delivery register spells the one word for a blocked address. */}
        {chip === null ? <KeinTag>Nichts zu melden</KeinTag> : <span className={`${labelBadge(chip.tone)} h-7 shrink-0`}>{chip.label}</span>}
      </Angabe>
    </>
  );
}
