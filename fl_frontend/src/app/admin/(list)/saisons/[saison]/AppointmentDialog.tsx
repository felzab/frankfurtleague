"use client";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { saveSpiel } from "@/features/spiele/saveSpiel";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { FieldPair } from "@/kit/FieldPair";
import { TimeField } from "@/kit/TimeField";

import type { ActionAnswer } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { CalendarDay, TimeOfDay } from "@/core/format";

const ACT = { verb: "set", object: COPY.spielplan.appointment } as const;
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
  rules,
}: {
  spiel: string;
  version: number;
  /** What the match editor's save asks of the two boxes, read on the server. */
  rules: BoxRules;
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
    // The note names the other fixtures the save moved, which the dialog's toast says as it closes.
    if (answer.ok) return { ok: true, value: undefined, ...(answer.note === undefined ? {} : { note: answer.note }) };
    // A save held back for its question deletes a later result, which only a stale bracket's resolution sets off from a
    // date alone: the match editor asks it, and this dialog says so rather than stand open with nothing written.
    return answer.ask === undefined ? answer : { ok: false, reason: ADMIN_COPY.overview.voidsLater };
  };

  return (
    <Dialog
      title={TITLE}
      act={ACT}
      run={save}
      rules={rules}
      trigger={{ label: TITLE }}>
      <FieldPair>
        <DateField
          label={COPY.spielplan.fact.date}
          name={DATE}
          defaultValue={date}
        />
        <TimeField
          label={COPY.spielplan.fact.time}
          name={TIME}
          defaultValue={time}
        />
      </FieldPair>
    </Dialog>
  );
}
