"use client";

import { PressAct } from "@/kit/PressAct";
import { RowAct } from "@/kit/RowAct";
import { usePasskeyTouch } from "@/kit/usePasskeyTouch";

import { COPY } from "@/core/copy";
import { discardChange } from "@/features/address-change/actions";

import { resendChangeLink } from "./addressChangeActs";

import type { Fact } from "@/kit/Facts";

/**
 * What a running change's row does, each act behind the passkey touch, the last step of its press: „Link senden“ where
 * the change waits on the new mailbox, the one step a fresh link serves, its answer a toast, the row holding no status
 * line; and its ending, asked once, naming both addresses and whom it mails: „Zurückziehen“ in the wait, as Administratoren
 * says of the same record, and „Verwerfen“ before it. It stands quiet beside the re-send and secondary alone, as a lone
 * removal does on every list.
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

  return (
    <>
      {resends && (
        <PressAct
          variant="secondary"
          label={COPY.shared.withObject(COPY.account.address.link, "send")}
          act={touched(resendChangeLink)}
          payload={{ address_change_id: id, holder }}
          done={COPY.shared.toast.linkSent}
        />
      )}
      <RowAct
        verb={verb}
        subject={COPY.account.address.change}
        consequence={COPY.admin.addressChange.previousStays}
        facts={facts}
        act={discardChange}
        id={id}
        holder={holder}
        quiet={resends}
      />
    </>
  );
}
