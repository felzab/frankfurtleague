"use client";

import { saveSpiel } from "@/app/admin/(editor)/saisons/[saison]/spiele/[spiel]/saveSpiel";
import { Button } from "@/kit/Button";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { FieldPair } from "@/kit/FieldPair";
import { TimeField } from "@/kit/TimeField";

import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { CalendarDay, TimeOfDay } from "@/core/format";

const ACT = { verb: "set", object: COPY.admin.overview.appointment } as const;
const TITLE = COPY.shared.withObject(ACT.object, ACT.verb);

// Each box posts under the path the match editor's save places its refusal on.
const DATE = "changes.date";
const TIME = "changes.time";

const posted = (form: FormData, name: string): string | null => {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : null;
};

/**
 * „Termin setzen“ from a fixture's row: its day and its time, which are one value, saved through the match editor's
 * own save at the version the Übersicht read, so a fixture changed since is refused as stale rather than written over,
 * and everything else of it is sent as stored. The venue and its price stay the editor's.
 */
export function AppointmentDialog({
  spiel,
  version,
  date,
  time,
}: {
  spiel: string;
  version: number;
  /** What the fixture already holds, so a row lacking only its time opens on its day. */
  date: CalendarDay | null;
  time: TimeOfDay | null;
}) {
  const save = async (form: FormData): Promise<ActionAnswer> => {
    const answer = await saveSpiel({
      id: spiel,
      version,
      adoptsBericht: null,
      changes: { date: posted(form, DATE), time: posted(form, TIME) },
    });
    // The note names the other fixtures the save moved, which the dialog stays open to say.
    if (answer.ok) return { ok: true, value: undefined, ...(answer.note === undefined ? {} : { note: answer.note }) };
    // A save held back for its question deletes a later result, which only a stale bracket's resolution sets off from a
    // date alone: the match editor asks it, and this dialog says so rather than stand open with nothing written.
    return answer.ask === undefined ? answer : { ok: false, reason: COPY.admin.overview.voidsLater };
  };

  return (
    <Dialog
      title={TITLE}
      act={ACT}
      action={save}
      trigger={
        <Button
          variant="secondary"
          label={TITLE}
        />
      }>
      <FieldPair
        short="both"
        phone="pair">
        <DateField
          label={COPY.admin.spiel.date}
          name={DATE}
          defaultValue={date}
        />
        <TimeField
          label={COPY.admin.spiel.time}
          name={TIME}
          defaultValue={time}
        />
      </FieldPair>
    </Dialog>
  );
}
