"use client";

import { useState } from "react";

import { COPY } from "@/core/copy/shared";
import { Dialog } from "@/kit/Dialog";
import { useLocked } from "@/kit/draftUnsaved";
import { usePressAct } from "@/kit/PressAct";
import { SideActs } from "@/kit/SideActs";
import { TextField } from "@/kit/TextField";

import type { ActionAnswer, DryRunAction } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { FLKontaktpersonAdmin, FLKontaktSeat } from "@/core/generated/client/types";
import type { SideAct } from "@/kit/SideActs";
import type { ReactNode } from "react";

const EDIT = COPY.shared.withObject(COPY.team.seat, "edit");
const SEND = COPY.shared.withObject(COPY.shared.link, "send");
const ACT = { verb: "save" } as const;

/**
 * A seat row's acts, on an application and on a club alike: „Link senden“ while its person owes an answer, and „Sitz
 * bearbeiten“, whose dialog replaces the person, or fills a seat emptied, each box posting under the name both writes
 * read. The seat's write hands the team's panel to the address it stores, so it is behind the passkey touch, which its
 * dialog's press asks. An act inside an editor waits for an unsaved draft, since the write raises the count the draft's
 * save sends.
 * Both are the row's side acts (`SideActs`), in the form the list decides: their labelled buttons in a wide box and the
 * entries of one „⋯“ in a narrow one, a locked one saying why either way, the fresh link first.
 */
export function SeatActs<Key>({
  seats,
  person,
  rules,
  write,
  carry,
  holder,
  link,
  children,
}: {
  /** Every seat the row's person holds. */
  seats: readonly FLKontaktSeat[];
  /** `null` on an emptied seat. */
  person: Pick<FLKontaktpersonAdmin, "first_name" | "last_name" | "email" | "phone"> | null;
  /** What the browser's pass holds the boxes to: the write's lane's rules, read on the server (`boxRulesOf`). */
  rules: BoxRules;
  /** The seat's write, whose dry run its dialog's press sends before the touch. */
  write: DryRunAction<FormData>;
  /** What the dialog posts beside its boxes: the seat and the version the page read. */
  carry: Readonly<Record<string, string>>;
  /** The address the page was drawn for, which the touch and the seat's write post. */
  holder: string;
  /** The fresh link's press, `null` while the seat waits on nobody. */
  link: { send: (key: Key) => Promise<ActionAnswer>; seat: Key } | null;
  /** The boxes this record's seat holds beside the person's. */
  children?: ReactNode;
}) {
  const unsaved = useLocked(undefined);
  const sending = usePressAct(COPY.shared.toast.linkSent);
  const [isEditing, setEditing] = useState(false);

  const send: SideAct | null =
    link === null
      ? null
      : {
          label: SEND,
          isBusy: sending.isBusy,
          ...(unsaved === undefined ? {} : { locked: unsaved }),
          onPress: () => sending.press(() => link.send(link.seat)),
        };
  const edit: SideAct = {
    label: EDIT,
    ...(unsaved === undefined ? {} : { locked: unsaved }),
    onPress: () => setEditing(true),
  };

  return (
    <SideActs acts={send === null ? [edit] : [send, edit]}>
      {/* Held closed while the edit is locked: nothing opens it then. */}
      <Dialog
        title={EDIT}
        lead={COPY.team.seatsHeld(seats)}
        act={ACT}
        run={write}
        rules={rules}
        carry={carry}
        touch={{ holder }}
        open={{ isOpen: isEditing, onOpenChange: setEditing }}>
        <TextField
          label={COPY.shared.firstName}
          name="first_name"
          kind="text"
          defaultValue={person?.first_name}
        />
        <TextField
          label={COPY.shared.lastName}
          name="last_name"
          kind="text"
          defaultValue={person?.last_name}
        />
        <TextField
          label={COPY.shared.emailAddress}
          name="email"
          kind="email"
          defaultValue={person?.email}
        />
        <TextField
          label={COPY.shared.facts.phone}
          name="phone"
          kind="tel"
          defaultValue={person?.phone}
        />
        {children}
      </Dialog>
    </SideActs>
  );
}
