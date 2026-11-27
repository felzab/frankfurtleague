import { boxRulesOf } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { acceptBewerbung } from "@/features/bewerbungen/acceptBewerbung";
import { Dialog } from "@/kit/Dialog";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import { declineBewerbung } from "./declineBewerbung";

import type { ReactNode } from "react";

const OBJECT = COPY.shared.bewerbung;

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
      run={acceptBewerbung}
      rules={boxRulesOf(acceptBewerbung)}
      carry={{ id, version: String(version) }}
      trigger={{ label: COPY.shared.verb.accept, variant: "primary" }}>
      {children}
      <Facts facts={[{ label: ADMIN_COPY.facts.mailTo, value: ADMIN_COPY.bewerbung.allSeats }]} />
    </Dialog>
  );
}

/** „Ablehnen“ beside it: the reason, which the mail hands over as typed, and whom it mails. */
export function DeclineDialog({ id, version }: Decided) {
  return (
    <Dialog
      title={COPY.shared.withObject(OBJECT, "decline")}
      act={{ verb: "decline" }}
      // A refusal is the dialog's destroying act: the red fill every destroying press takes.
      tone="danger"
      run={declineBewerbung}
      rules={boxRulesOf(declineBewerbung)}
      carry={{ id, version: String(version) }}
      trigger={{ label: COPY.shared.verb.decline }}>
      <TextField
        label={COPY.shared.reason}
        name="reason"
        kind="paragraph"
        description={COPY.shared.noNames}
      />
      <Facts facts={[{ label: ADMIN_COPY.facts.mailTo, value: ADMIN_COPY.bewerbung.mailedSeats }]} />
    </Dialog>
  );
}
