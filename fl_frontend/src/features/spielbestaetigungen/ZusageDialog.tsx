"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { Segmented } from "@/kit/ChoiceButtons";
import { Dialog } from "@/kit/Dialog";

import { enterZusage } from "./enterZusage";

import type { ActionAnswer } from "@/core/action";
import type { Words } from "@/core/copy";
import type { ReactNode } from "react";

const WORDS = ADMIN_COPY.overview;
const ACT = { verb: "enter", object: WORDS.zusage } as const;
const TITLE = COPY.shared.withObject(ACT.object, ACT.verb);

/** One party still to answer: its confirmation row, by the party's name. */
export type OpenParty = { id: string; name: Words };

/**
 * „Zusage eintragen“ from a fixture's row, or from one party's: which party still to answer agreed, one segment each,
 * and how the agreement reached the league, which the confirmation stores as the reason the write requires. A segment
 * posts no form value, so the choice is held here and joins the form as its row's id; the reason's box is drawn on the
 * server.
 */
export function ZusageDialog({
  parties,
  partyRequired,
  children,
}: {
  parties: readonly [OpenParty, ...OpenParty[]];
  /** Whether the write asks for the party's row, read off its schema on the server. */
  partyRequired: boolean;
  /** The reason's box, posting under the name `enterZusage` reads it by. */
  children: ReactNode;
}) {
  const [picked, choose] = useState(parties[0].id);
  // The dialog outlives a fresh read of its row, which drops a party once its answer is entered: a pick no longer
  // among the parties falls back to the first still to answer, never posting an answered row.
  const chosen = parties.some((party) => party.id === picked) ? picked : parties[0].id;

  const enter = (form: FormData): Promise<ActionAnswer> => {
    form.set("id", chosen);
    return enterZusage(form);
  };

  return (
    <Dialog
      title={TITLE}
      act={ACT}
      run={enter}
      trigger={{ label: TITLE }}>
      <Segmented
        label={WORDS.zusageFrom}
        choices={parties.map((party) => ({ id: party.id, label: party.name }))}
        isRequired={partyRequired}
        value={chosen}
        onChange={choose}
      />
      {children}
    </Dialog>
  );
}
