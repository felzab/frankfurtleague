import { boxRulesOf } from "@/core/action";
import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { FieldGroup } from "@/kit/FieldGroup";
import { FieldPair } from "@/kit/FieldPair";
import { TextField } from "@/kit/TextField";
import { TimeField } from "@/kit/TimeField";

import { declineSpielbestaetigung } from "./answerSpielbestaetigung";

import type { Words } from "@/core/copy";
import type { CalendarDay } from "@/core/format";

/**
 * „Ablehnen“ on a date's row: the dialog asking for the day and hour the team proposes instead and, where it gives
 * one, its reason, named for the fixture under its title. The day's box takes no day before today, which the backend
 * refuses, so a past day is marked under it before anything is sent.
 */
export function DeclineDialog({
  id,
  spiel,
  today,
}: {
  /** The confirmation row the answer names. */
  id: string;
  /** The fixture, by its two clubs. */
  spiel: Words;
  today: CalendarDay;
}) {
  return (
    <Dialog
      title={COPY.shared.withObject(COPY.spielplan.appointment, "decline")}
      act={{ verb: "decline" }}
      // A refusal is the dialog's destroying act: the red fill every destroying press takes.
      tone="danger"
      lead={spiel}
      run={declineSpielbestaetigung}
      rules={boxRulesOf(declineSpielbestaetigung)}
      carry={{ id }}
      consequence={AREA_COPY.team.declineConsequence}
      trigger={{ label: COPY.shared.verb.decline }}>
      <FieldGroup name={COPY.spielplan.vorschlag}>
        <FieldPair>
          <DateField
            label={COPY.spielplan.fact.date}
            name="date"
            minValue={today}
          />
          <TimeField
            label={COPY.spielplan.fact.time}
            name="time"
          />
        </FieldPair>
      </FieldGroup>
      <TextField
        label={COPY.shared.reason}
        name="reason"
        // A paragraph, at four lines, its line breaks kept, as the administration's reasons are.
        kind="paragraph"
        description={COPY.shared.noNames}
      />
    </Dialog>
  );
}
