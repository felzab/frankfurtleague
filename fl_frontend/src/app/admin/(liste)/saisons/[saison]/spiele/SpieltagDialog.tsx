"use client";

import { useState } from "react";

import { Button } from "@/kit/Button";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { FieldPair } from "@/kit/FieldPair";

import { COPY } from "@/core/copy";

import { saveSpieltag } from "./saveSpieltag";

import type { CalendarDay } from "@/core/format";

const WORDS = COPY.admin.spiel;

/**
 * The matchday's „Bearbeiten“: its two dates in a dialog over the list, filled from the list's own read of the
 * matchday and saved on the version that read served, so no second read stands behind the dialog.
 */
export function SpieltagDialog({
  id,
  version,
  stored,
  required,
}: {
  id: string;
  version: number;
  /** The matchday's dates as stored, each `null` while it is undated. */
  stored: { beginn: CalendarDay | null; ende: CalendarDay | null };
  /** Whether the write takes the matchday without each date, read off its schema on the server. */
  required: { beginn: boolean; ende: boolean };
}) {
  const [beginn, setBeginn] = useState(stored.beginn);
  const [ende, setEnde] = useState(stored.ende);
  return (
    <Dialog
      title={COPY.shared.withObject(COPY.spielplan.fact.spieltag, "edit")}
      act={{ verb: "save" }}
      // An empty required date never reaches the write: the form keeps the send back.
      action={() => saveSpieltag({ id, version, beginn: beginn ?? "", ende: ende ?? "" })}
      trigger={
        <Button
          variant="secondary"
          label={COPY.shared.verb.edit}
        />
      }>
      {/* A span's two ends are one value, sharing their row at every width. */}
      <FieldPair
        short="both"
        phone="pair">
        <DateField
          label={WORDS.beginn}
          name="beginn"
          isRequired={required.beginn}
          value={beginn}
          onChange={setBeginn}
        />
        <DateField
          label={WORDS.ende}
          name="ende"
          isRequired={required.ende}
          value={ende}
          onChange={setEnde}
          // A span ending before it begins is refused here, before the write sees it.
          {...(beginn === null ? {} : { minValue: beginn })}
        />
      </FieldPair>
    </Dialog>
  );
}
