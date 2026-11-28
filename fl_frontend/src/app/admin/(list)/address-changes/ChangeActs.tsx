"use client";

import { useState } from "react";

import { COPY } from "@/core/copy/shared";
import { discardChange } from "@/features/address-change/actions";
import { ConfirmDialog } from "@/kit/ConfirmDialog";
import { usePressAct } from "@/kit/PressAct";
import { SideActs } from "@/kit/SideActs";
import { usePasskeyTouch } from "@/kit/usePasskeyTouch";

import { resendChangeLink } from "./addressChangeActs";

import type { Fact } from "@/kit/Facts";
import type { SideAct } from "@/kit/SideActs";

/**
 * What a running change's row does, each act behind the passkey touch, the last step of its press: „Link senden“ where
 * the change waits on the new mailbox, the one step a fresh link serves, its answer a toast, the row holding no status
 * line; and its ending, asked once, naming both addresses and whom it mails: „Zurückziehen“ in the wait, as Administratoren
 * says of the same record, and „Verwerfen“ before it, in the danger hue of every destroying act.
 *
 * Both are side acts of the row (`SideActs`), the fresh link first, in the form the list decides: their labelled
 * buttons in a wide box, and the entries of one „⋯“ in a narrow one. The fresh link runs from its entry's own
 * press, which is the press the touch is asked from; the ending's question is held here and opened by its entry or its
 * button, and its own final press asks the touch.
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
  const touched = usePasskeyTouch(true, holder);
  const resend = usePressAct(COPY.shared.toast.linkSent);
  const [isAsking, setAsking] = useState(false);

  const send: SideAct = {
    label: COPY.shared.withObject(COPY.shared.link, "send"),
    isBusy: resend.isBusy,
    onPress: () => resend.press(() => touched(resendChangeLink)({ address_change_id: id, holder })),
  };
  const end: SideAct = { label: COPY.shared.verb[verb], tone: "danger", onPress: () => setAsking(true) };

  return (
    <SideActs acts={resends ? [send, end] : [end]}>
      <ConfirmDialog
        question={{
          verb,
          subject: COPY.shared.addressChange.change,
          consequence: COPY.shared.addressChange.previousStays,
          facts,
          tone: "danger",
        }}
        touch={{ holder }}
        onConfirm={() => discardChange({ id, holder })}
        open={{ isOpen: isAsking, onOpenChange: setAsking }}
      />
    </SideActs>
  );
}
