"use client";

import { useState, useTransition } from "react";

import { seatsText } from "@/core/copy";
import { COPY } from "@/core/copy/shared";
import { Dialog } from "@/kit/Dialog";
import { useLocked } from "@/kit/draftUnsaved";
import { usePressAct } from "@/kit/PressAct";
import { SideActs } from "@/kit/SideActs";
import { TextField } from "@/kit/TextField";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLKontaktpersonAdmin, FLKontaktSeat } from "@/core/generated/client/types";
import type { SeatRules } from "@/features/teams/fieldRules";
import type { SideAct } from "@/kit/SideActs";
import type { ReactNode } from "react";

const EDIT = COPY.shared.withObject(COPY.team.seat, "edit");
const SEND = COPY.shared.withObject(COPY.shared.link, "send");
const ACT = { verb: "save" } as const;

/**
 * A seat row's acts, on an application and on a club alike: „Link senden“ while its person owes an answer, and „Sitz
 * bearbeiten“, whose dialog replaces the person, or fills a seat emptied, each box posting under the name both writes
 * read. The seat's write hands the team's panel to the address it stores, so it is behind the passkey touch: its press
 * closes the dialog, asks the touch and writes, its answer a toast. An act inside an editor waits for an unsaved draft,
 * since the write raises the count the draft's save sends.
 * Both are the row's side acts (`SideActs`), in the form the list decides: their labelled buttons in a wide box and the
 * entries of one „⋯“ in a narrow one, a locked one saying why either way, the fresh link first.
 */
export function SeatActs<Key>({
  seats,
  person,
  rules: { required, max },
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
  rules: SeatRules;
  write: (form: FormData) => Promise<ActionAnswer>;
  /** What the dialog posts beside its boxes: the seat and the version the page read. */
  carry: Readonly<Record<string, string>>;
  /** The address the page was drawn for, which the touch and the seat's write post. */
  holder: string;
  /** The fresh link's press, `null` while the seat waits on nobody; `locked` says why no link goes. */
  link: { send: (key: Key) => Promise<ActionAnswer>; seat: Key; locked?: Copy } | null;
  /** The boxes this record's seat holds beside the person's. */
  children?: ReactNode;
}) {
  const unsaved = useLocked(undefined);
  const sendLocked = useLocked(link?.locked);
  const sending = usePressAct(COPY.shared.toast.linkSent);
  const [isEditing, setEditing] = useState(false);
  // The seat's write runs after its dialog closed, so the edit's button or the row's „⋯“ shows it running.
  const writing = useTransition();
  const [isWriting] = writing;

  const send: SideAct | null =
    link === null
      ? null
      : {
          label: SEND,
          isBusy: sending.isBusy,
          ...(sendLocked === undefined ? {} : { locked: sendLocked }),
          onPress: () => sending.press(() => link.send(link.seat)),
        };
  const edit: SideAct = {
    label: EDIT,
    isBusy: isWriting,
    ...(unsaved === undefined ? {} : { locked: unsaved }),
    onPress: () => setEditing(true),
  };

  return (
    <SideActs acts={send === null ? [edit] : [send, edit]}>
      {/* Held closed while the edit is locked: nothing opens it then. */}
      <Dialog
        title={EDIT}
        lead={{ record: seatsText(seats) }}
        act={ACT}
        run={write}
        carry={carry}
        touch={{ holder }}
        open={{ isOpen: isEditing, onOpenChange: setEditing }}
        transition={writing}>
        <TextField
          label={COPY.shared.firstName}
          name="first_name"
          kind="text"
          isRequired={required.first_name}
          maxLength={max.first_name}
          defaultValue={person?.first_name}
        />
        <TextField
          label={COPY.shared.lastName}
          name="last_name"
          kind="text"
          isRequired={required.last_name}
          maxLength={max.last_name}
          defaultValue={person?.last_name}
        />
        <TextField
          label={COPY.shared.emailAddress}
          name="email"
          kind="email"
          isRequired={required.email}
          maxLength={max.email}
          defaultValue={person?.email}
        />
        <TextField
          label={COPY.shared.facts.phone}
          name="phone"
          kind="tel"
          isRequired={required.phone}
          defaultValue={person?.phone}
        />
        {children}
      </Dialog>
    </SideActs>
  );
}
