import { formatAktionZeitpunkt } from "@/features/aktionen/utils";
import { zustellungChip } from "@/features/bewerbungen/zustellLage";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLOutboxState } from "@/core/generated/client/types";
import type { ReactNode } from "react";

/** Beside the deadline rather than among the delivery facts, which say what became of the message. */
const LINK_ABGELAUFEN_LABEL = "abgelaufen";

/** An instant in the action log's words, the administrator's other reading of one. */
export function zeitpunktText(instant: string): string {
  const { datum, uhrzeit } = formatAktionZeitpunkt(instant);

  return uhrzeit === null ? datum : `${datum} um ${uhrzeit} Uhr`;
}

/**
 * One confirmation link's sent day, deadline and delivery, as every administrator editor showing a
 * link reads them out, so one state is one word on each.
 */
export function LinkStandAngaben({
  verschicktAm,
  frist,
  fristArt = "tag",
  istAbgelaufen,
  zustellung,
  vorZustellung,
}: {
  verschicktAm: string;
  frist: string;
  /** `zeitpunkt` for a link lapsing at an instant rather than at a day's end, stated to the minute in Berlin. */
  fristArt?: "tag" | "zeitpunkt";
  /** The read's judgement of the deadline, never this browser's day; false where a lapse costs nothing. */
  istAbgelaufen: boolean;
  /** What became of the last mail owed about the link, `null` where none was ever owed. */
  zustellung: FLOutboxState | null;
  /** A fact of the caller's own between the deadline and the delivery. */
  vorZustellung?: ReactNode;
}) {
  const chip = zustellungChip(zustellung);

  return (
    <>
      <Angabe label="Link gesendet am">{formatSpielDatum(verschicktAm)}</Angabe>
      <Angabe label="Gültig bis">
        {fristArt === "tag" ? formatSpielDatum(frist) : zeitpunktText(frist)}
        {istAbgelaufen && <span className={`${labelBadge("warning")} ms-2 h-7 shrink-0`}>{LINK_ABGELAUFEN_LABEL}</span>}
      </Angabe>
      {vorZustellung}
      <Angabe label="Zustellung">
        {/* `null` covers owed, sent and delivered alike: the chip exists for what an administrator can act on. */}
        {chip === null ? <Leer>Nichts zu melden</Leer> : <span className={`${labelBadge(chip.tone)} h-7 shrink-0`}>{chip.label}</span>}
      </Angabe>
    </>
  );
}
