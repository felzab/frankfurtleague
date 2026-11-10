import { Button } from "@/kit/Button";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { FieldGroup } from "@/kit/FieldGroup";
import { FieldPair } from "@/kit/FieldPair";
import { TextField } from "@/kit/TextField";
import { TimeField } from "@/kit/TimeField";

import { blankIsNull, requires } from "@/core/action";
import { COPY } from "@/core/copy";
import { SpielbestaetigungenPostTeamAnswerBody, spielbestaetigungenPostTeamAnswerBodyReasonOneMax } from "@/core/generated/zod/inputs";

import { declineTermin } from "./answerTermin";

import type { Words } from "@/core/copy";
import type { CalendarDay } from "@/core/format";

const answer = SpielbestaetigungenPostTeamAnswerBody.shape;
const vorschlag = answer.vorschlag.options[0].shape;

// Read off the write's schema on the server, so it never reaches the browser.
const REQUIRED = {
  date: requires(vorschlag.date, ""),
  time: requires(vorschlag.time, ""),
  reason: requires(blankIsNull(answer.reason), ""),
};

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
      title={COPY.shared.withObject(COPY.admin.overview.appointment, "decline")}
      act={{ verb: "decline" }}
      // A refusal is the dialog's destroying act: the red fill every destroying press takes.
      tone="danger"
      lead={spiel}
      action={declineTermin}
      carry={{ id }}
      consequence={COPY.area.team.declineConsequence}
      trigger={
        <Button
          variant="secondary"
          label={COPY.shared.verb.decline}
        />
      }>
      <FieldGroup name={COPY.admin.overview.vorschlag}>
        <FieldPair>
          <DateField
            label={COPY.admin.spiel.date}
            name="date"
            isRequired={REQUIRED.date}
            minValue={today}
          />
          <TimeField
            label={COPY.admin.spiel.time}
            name="time"
            isRequired={REQUIRED.time}
          />
        </FieldPair>
      </FieldGroup>
      <TextField
        label={COPY.admin.overview.reason}
        name="reason"
        // A paragraph, at four lines, its line breaks kept, as the administration's reasons are.
        kind="paragraph"
        isRequired={REQUIRED.reason}
        maxLength={spielbestaetigungenPostTeamAnswerBodyReasonOneMax}
        description={COPY.admin.noNames}
      />
    </Dialog>
  );
}
