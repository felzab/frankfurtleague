"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/kit/ConfirmDialog";
import { SideActs } from "@/kit/SideActs";
import { toastAnswer } from "@/kit/Toast";
import { answering } from "@/kit/useFormAction";
import { usePasskeyTouch } from "@/kit/usePasskeyTouch";

import { COPY } from "@/core/copy";
import { discardChange } from "@/features/address-change/actions";

import { resendChangeLink } from "./addressChangeActs";

import type { Fact } from "@/kit/Facts";
import type { SideAct } from "@/kit/SideActs";

/**
 * What a running change's row does, each act behind the passkey touch, the last step of its press: „Link senden“ where
 * the change waits on the new mailbox, the one step a fresh link serves, its answer a toast, the row holding no status
 * line; and its ending, asked once, naming both addresses and whom it mails: „Zurückziehen“ in the wait, as Administratoren
 * says of the same record, and „Verwerfen“ before it, in the danger hue of every destroying act.
 *
 * Both are side acts of the row (`SideActs`), the entries of its „⋯“. The fresh link runs from the entry's own press,
 * which is the press the touch is asked from; the ending's question is held here and opened by its entry, and its own
 * final press asks the touch.
 */
export function ChangeActs({
  id,
  resends,
  verb,
  facts,
  holder,
}: {
  id: string;
  resends: boolean;
  verb: "discard" | "withdraw";
  facts: ReadonlyArray<Fact>;
  /** The address the page was drawn for, which the touch and each act post. */
  holder: string;
}) {
  const router = useRouter();
  const touched = usePasskeyTouch(true, holder);
  const [isSending, startSending] = useTransition();
  const [isAsking, setAsking] = useState(false);

  const send: SideAct = {
    label: COPY.shared.withObject(COPY.account.address.link, "send"),
    isBusy: isSending,
    onPress: () =>
      startSending(async () => {
        toastAnswer(await answering(touched(resendChangeLink), router.refresh)({ address_change_id: id, holder }), COPY.shared.toast.linkSent);
      }),
  };
  const end: SideAct = { label: COPY.shared.verb[verb], tone: "danger", onPress: () => setAsking(true) };

  return (
    <SideActs acts={resends ? [send, end] : [end]}>
      <ConfirmDialog
        verb={verb}
        subject={COPY.account.address.change}
        consequence={COPY.admin.addressChange.previousStays}
        facts={facts}
        tone="danger"
        touch={{ holder }}
        onConfirm={() => discardChange({ id, holder })}
        open={{ isOpen: isAsking, onOpenChange: setAsking }}
      />
    </SideActs>
  );
}
