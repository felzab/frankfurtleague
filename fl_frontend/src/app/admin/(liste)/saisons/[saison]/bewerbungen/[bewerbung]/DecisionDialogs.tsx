import { Button } from "@/kit/Button";
import { Dialog } from "@/kit/Dialog";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";

import { acceptBewerbung, declineBewerbung } from "./decideBewerbung";

import type { ReactNode } from "react";

const OBJECT = COPY.bewerbung.object;

/** Each decision mails every seat. */
const MAILS = [{ label: COPY.admin.facts.mailTo, value: COPY.admin.bewerbung.allSeats }];

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
      trigger={
        <Button
          variant="primary"
          label={COPY.shared.verb.accept}
        />
      }>
      {children}
      <Facts facts={MAILS} />
    </Dialog>
  );
}

/** „Ablehnen“ beside it: the reason, which the mail hands over as typed, and whom it mails. */
export function DeclineDialog({ id, version, required, max }: Decided & { required: boolean; max: number }) {
  return (
    <Dialog
      title={COPY.shared.withObject(OBJECT, "decline")}
      act={{ verb: "decline" }}
      action={declineBewerbung}
      carry={{ id, version: String(version) }}
      trigger={
        <Button
          variant="secondary"
          label={COPY.shared.verb.decline}
        />
      }>
      <TextField
        label={COPY.admin.spiel.reason}
        name="reason"
        width="W4"
        kind="text"
        isRequired={required}
        maxLength={max}
        description={COPY.admin.noNames}
      />
      <Facts facts={MAILS} />
    </Dialog>
  );
}
