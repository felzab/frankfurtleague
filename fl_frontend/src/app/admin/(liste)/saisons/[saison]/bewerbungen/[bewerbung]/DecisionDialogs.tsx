import { Dialog } from "@/kit/Dialog";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";

import { acceptBewerbung, declineBewerbung } from "./decideBewerbung";

import type { ReactNode } from "react";

const OBJECT = COPY.bewerbung.object;

/** The record a decision writes: which application, on the version the page read. */
type Decided = { id: string; version: number };

/**
 * „Annehmen“ under the application's facts: the group, the colour and the code, whose fields the page draws, and whom it
 * mails.
 */
export function AcceptDialog({ id, version, children }: Decided & { children: ReactNode }) {
  return (
    <Dialog
      title={COPY.shared.withObject(OBJECT, "accept")}
      act={{ verb: "accept" }}
      action={acceptBewerbung}
      carry={{ id, version: String(version) }}
      trigger={{ label: COPY.shared.verb.accept, variant: "primary" }}>
      {children}
      <Facts facts={[{ label: COPY.admin.facts.mailTo, value: COPY.admin.bewerbung.allSeats }]} />
    </Dialog>
  );
}

/** „Ablehnen“ beside it: the reason, which the mail hands over as typed, and whom it mails. */
export function DeclineDialog({ id, version, required, max }: Decided & { required: boolean; max: number }) {
  return (
    <Dialog
      title={COPY.shared.withObject(OBJECT, "decline")}
      act={{ verb: "decline" }}
      // A refusal is the dialog's destroying act: the red fill every destroying press takes.
      tone="danger"
      action={declineBewerbung}
      carry={{ id, version: String(version) }}
      trigger={{ label: COPY.shared.verb.decline }}>
      <TextField
        label={COPY.admin.spiel.reason}
        name="reason"
        kind="paragraph"
        isRequired={required}
        maxLength={max}
        description={COPY.admin.noNames}
      />
      <Facts facts={[{ label: COPY.admin.facts.mailTo, value: COPY.admin.bewerbung.mailedSeats }]} />
    </Dialog>
  );
}
