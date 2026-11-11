"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog } from "@/kit/Dialog";
import { useLocked } from "@/kit/draftUnsaved";
import { SideActs } from "@/kit/SideActs";
import { TextField } from "@/kit/TextField";
import { toastAnswer } from "@/kit/Toast";
import { answering } from "@/kit/useFormAction";

import { COPY, rollenText } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLKontaktperson, FLKontaktRolle } from "@/core/generated/client/types";
import type { SeatRules } from "@/features/teams/fieldRules";
import type { SideAct } from "@/kit/SideActs";
import type { ReactNode } from "react";

const EDIT = COPY.shared.withObject(COPY.team.seat, "edit");
const SEND = COPY.shared.withObject(COPY.account.address.link, "send");
const ACT = { verb: "save" } as const;

/**
 * A seat row's acts, on an application and on a club alike: „Link senden“ while its person owes an answer, and „Sitz
 * bearbeiten“, whose dialog replaces the person, or fills a seat emptied, each box posting under the name both writes
 * read. An act inside an editor waits for an unsaved draft, since the write raises the count the draft's save sends.
 * Both are the row's side acts (`SideActs`): the entries of the „⋯“ at the row's end, a locked one saying why there.
 */
export function SeatActs<Key>({
  rollen,
  person,
  rules: { required, max },
  write,
  carry,
  link,
  children,
}: {
  /** Every seat the row's person holds. */
  rollen: readonly FLKontaktRolle[];
  /** `null` on an emptied seat. */
  person: Pick<FLKontaktperson, "first_name" | "last_name" | "email" | "phone"> | null;
  rules: SeatRules;
  write: (form: FormData) => Promise<ActionAnswer>;
  /** What the dialog posts beside its boxes: the seat and the version the page read. */
  carry: Readonly<Record<string, string>>;
  /** The fresh link's press, `null` while the seat waits on nobody; `locked` says why no link goes. */
  link: { send: (key: Key) => Promise<ActionAnswer>; seat: Key; locked?: Copy } | null;
  /** The boxes this record's seat holds beside the person's. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const unsaved = useLocked(undefined);
  const sendLocked = useLocked(link?.locked);
  const [isSending, startSending] = useTransition();
  const [isEditing, setEditing] = useState(false);

  const send: SideAct | null =
    link === null
      ? null
      : {
          label: SEND,
          isBusy: isSending,
          ...(sendLocked === undefined ? {} : { locked: sendLocked }),
          onPress: () =>
            startSending(async () => {
              toastAnswer(await answering(link.send, router.refresh)(link.seat), COPY.shared.toast.linkSent);
            }),
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
        lead={{ record: rollenText(rollen) }}
        act={ACT}
        action={write}
        carry={carry}
        open={{ isOpen: isEditing, onOpenChange: setEditing }}>
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
          label={COPY.signIn.address}
          name="email"
          kind="email"
          autofill="off"
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
