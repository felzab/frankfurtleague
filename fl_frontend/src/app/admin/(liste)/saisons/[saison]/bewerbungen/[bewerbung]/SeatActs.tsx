"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/kit/Button";
import { Dialog } from "@/kit/Dialog";
import { FieldGroup } from "@/kit/FieldGroup";
import { FieldPair } from "@/kit/FieldPair";
import { TextField } from "@/kit/TextField";
import { appToast } from "@/kit/Toast";
import { answering } from "@/kit/useFormAction";

import { COPY } from "@/core/copy";

import { sendSeatLink, writeSeat } from "./writeSeat";

import type { ActionAnswer } from "@/core/action";
import type { FLKontaktperson, FLKontaktRolle } from "@/core/generated/client/types";
import type { SeatRules } from "@/features/bewerbungen/fieldRules";

const ACT = COPY.shared.withObject(COPY.team.seat, "edit");
const SEND = COPY.shared.withObject(COPY.account.address.link, "send");

/**
 * A seat row's acts: „Link senden“ while its person still owes an answer, then or later, and „Sitz bearbeiten“, the
 * dialog holding the seat's person, or nobody on a seat a Widerspruch emptied, each box posting under the name `writeSeat` reads.
 */
export function SeatActs({
  id,
  version,
  seat,
  rollen,
  person,
  sendable,
  rules: { required, max },
}: {
  id: string;
  version: number;
  seat: FLKontaktRolle;
  rollen: readonly FLKontaktRolle[];
  person: FLKontaktperson | null;
  sendable: boolean;
  rules: SeatRules;
}) {
  const router = useRouter();
  const [isSending, startSending] = useTransition();

  const send = () =>
    startSending(async () => {
      const answer = await answering(sendSeatLink, router.refresh)({ bewerbung_id: id, seat });
      if (answer.ok) appToast("success", COPY.shared.toast.linkSent);
      else appToast("danger", COPY.shared.toast.failure);
    });

  const write = (form: FormData): Promise<ActionAnswer> => {
    form.set("id", id);
    form.set("seat", seat);
    form.set("version", String(version));
    return writeSeat(form);
  };

  return (
    <>
      {sendable && (
        <Button
          icon="email"
          label={SEND}
          isBusy={isSending}
          onPress={send}
        />
      )}
      <Dialog
        title={ACT}
        act={{ verb: "save" }}
        action={write}
        trigger={
          <Button
            icon="rename"
            label={ACT}
          />
        }>
        <FieldGroup name={COPY.admin.seatLine(rollen, null, null)}>
          <FieldPair
            short="both"
            phone="stack">
            <TextField
              label={COPY.shared.firstName}
              name="first_name"
              width="W3"
              kind="text"
              isRequired={required.first_name}
              maxLength={max.first_name}
              defaultValue={person?.first_name ?? ""}
            />
            <TextField
              label={COPY.shared.lastName}
              name="last_name"
              width="W3"
              kind="text"
              isRequired={required.last_name}
              maxLength={max.last_name}
              defaultValue={person?.last_name ?? ""}
            />
          </FieldPair>
          <TextField
            label={COPY.signIn.address}
            name="email"
            width="W3"
            kind="email"
            isRequired={required.email}
            maxLength={max.email}
            defaultValue={person?.email ?? ""}
          />
          <TextField
            label={COPY.account.entries.facts.phone}
            name="phone"
            width="W3"
            kind="tel"
            isRequired={required.phone}
            defaultValue={person?.phone ?? ""}
          />
        </FieldGroup>
      </Dialog>
    </>
  );
}
