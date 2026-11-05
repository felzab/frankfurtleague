"use client";

import { saveSpiel } from "@/app/admin/(editor)/saisons/[saison]/spiele/[spiel]/saveSpiel";
import { Button } from "@/kit/Button";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { FieldPair } from "@/kit/FieldPair";
import { TimeField } from "@/kit/TimeField";

import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { CalendarDay, Uhrzeit } from "@/core/format";

const ACT = { verb: "set", object: COPY.admin.overview.termin } as const;
const TITLE = COPY.shared.withObject(ACT.object, ACT.verb);

// Each box posts under the path the match editor's save places its refusal on.
const DATUM = "changes.datum";
const UHRZEIT = "changes.uhrzeit";

const posted = (form: FormData, name: string): string | null => {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : null;
};

/**
 * „Termin setzen“ from a fixture's row: its day and its time, which are one value, saved through the match editor's
 * own save at the version the Übersicht read, so a fixture changed since is refused as stale rather than written over,
 * and everything else of it is sent as stored. The venue and its price stay the editor's.
 */
export function TerminDialog({
  spiel,
  version,
  datum,
  uhrzeit,
}: {
  spiel: string;
  version: number;
  /** What the fixture already holds, so a row lacking only its time opens on its day. */
  datum: CalendarDay | null;
  uhrzeit: Uhrzeit | null;
}) {
  const save = async (form: FormData): Promise<ActionAnswer> => {
    const answer = await saveSpiel({
      id: spiel,
      version,
      adoptsBericht: null,
      changes: { datum: posted(form, DATUM), uhrzeit: posted(form, UHRZEIT) },
    });
    return answer.ok ? { ok: true, value: undefined } : answer;
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
          label={COPY.admin.spiel.datum}
          name={DATUM}
          defaultValue={datum}
        />
        <TimeField
          label={COPY.admin.spiel.uhrzeit}
          name={UHRZEIT}
          defaultValue={uhrzeit}
        />
      </FieldPair>
    </Dialog>
  );
}
