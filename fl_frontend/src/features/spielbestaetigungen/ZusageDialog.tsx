"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { Segmented } from "@/kit/ChoiceButtons";
import { Dialog } from "@/kit/Dialog";
import { useLocked } from "@/kit/draftUnsaved";
import { TextField } from "@/kit/TextField";

import { enterZusage } from "./enterZusage";

import type { BoxRules } from "@/core/boxRules";
import type { Words } from "@/core/copy";

const WORDS = ADMIN_COPY.overview;
const ACT = { verb: "enter", object: WORDS.zusage } as const;
const TITLE = COPY.shared.withObject(ACT.object, ACT.verb);

/** One party still to answer: its confirmation row, by the party's name. */
export type OpenParty = { id: string; name: Words };

/**
 * „Zusage eintragen“ from a fixture's row, or from one party's: which party still to answer agreed, one segment each,
 * and how the agreement reached the league, which the confirmation stores as the reason the write requires. The choice
 * posts its party's row as `id`, the box a refusal of the party stands on.
 */
export function ZusageDialog({
  parties,
  rules,
}: {
  parties: readonly [OpenParty, ...OpenParty[]];
  /** What the Zusage's lane asks of its boxes, read on the server. */
  rules: BoxRules;
}) {
  // Locked inside an editor whose draft holds unsaved changes, as every act there is.
  const locked = useLocked(undefined);
  const [picked, choose] = useState(parties[0].id);
  // The dialog outlives a fresh read of its row, which drops a party once its answer is entered: a pick no longer
  // among the parties falls back to the first still to answer, never posting an answered row.
  const chosen = parties.some((party) => party.id === picked) ? picked : parties[0].id;

  return (
    <Dialog
      title={TITLE}
      act={ACT}
      run={enterZusage}
      rules={rules}
      trigger={{ label: TITLE, ...(locked === undefined ? {} : { locked }) }}>
      <Segmented
        label={WORDS.zusageFrom}
        name="id"
        choices={parties.map((party) => ({ id: party.id, label: party.name }))}
        value={chosen}
        onChange={choose}
      />
      <TextField
        label={COPY.spielplan.answerNote}
        // The name `enterZusage` reads the reason by.
        name="reason"
        // A paragraph: a reason a person writes, at four lines, its line breaks kept.
        kind="paragraph"
      />
    </Dialog>
  );
}
