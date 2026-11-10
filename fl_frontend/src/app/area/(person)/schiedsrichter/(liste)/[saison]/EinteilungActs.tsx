"use client";

import { Button } from "@/kit/Button";
import { Dialog } from "@/kit/Dialog";
import { PressAct } from "@/kit/PressAct";

import { COPY } from "@/core/copy";

import { agreeEinteilung, declineEinteilung } from "./answerEinteilung";

import type { Words } from "@/core/copy";
import type { ReactNode } from "react";

const TITLE = COPY.shared.withObject(COPY.area.schiedsrichter.einteilung, "decline");

/**
 * A booking still to answer, on its game's row: „Zusagen“ at once, its answer a toast as the row turns „Zugesagt“,
 * and „Ablehnen“ in the dialog asking for the reason, the game named under its title. Neither takes the passkey
 * touch. Both name the row's own confirmation, which is all either posts of the row.
 */
export function EinteilungActs({
  id,
  spiel,
  children,
}: {
  /** The confirmation row both answers name. */
  id: string;
  spiel: Words;
  /** The reason's box, drawn on the server so the write's schema stays there. */
  children: ReactNode;
}) {
  return (
    <>
      <PressAct
        variant="primary"
        label={COPY.shared.verb.agree}
        act={agreeEinteilung}
        payload={{ id }}
        done={COPY.shared.toast.agreed}
      />
      <Dialog
        title={TITLE}
        act={{ verb: "decline" }}
        lead={spiel}
        action={declineEinteilung}
        carry={{ id }}
        trigger={
          <Button
            variant="secondary"
            label={COPY.shared.verb.decline}
          />
        }>
        {children}
      </Dialog>
    </>
  );
}
