"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/kit/Button";
import { ConfirmDialog } from "@/kit/ConfirmDialog";
import { appToast } from "@/kit/Toast";
import { answering } from "@/kit/useFormAction";
import { usePasskeyTouch } from "@/kit/usePasskeyTouch";

import { COPY } from "@/core/copy";

import { discardChange, resendChangeLink } from "./addressChangeActs";

import type { Fact } from "@/kit/Facts";

/**
 * What a running change's row does, each act behind the passkey touch, the last step of its press: „Link senden“ where
 * the change waits on the new mailbox, the one step a fresh link serves, its answer a toast, the row holding no status
 * line; and „Verwerfen“, asked once, naming both addresses and whom it mails.
 */
export function ChangeActs({
  id,
  resends,
  discardFacts,
  holder,
}: {
  id: string;
  resends: boolean;
  discardFacts: ReadonlyArray<Fact>;
  /** The address the page was drawn for, which the touch and each act post. */
  holder: string;
}) {
  const router = useRouter();
  const [isSending, startSending] = useTransition();
  const touched = usePasskeyTouch(true, holder);
  const key = { address_change_id: id, holder };

  return (
    <>
      {resends && (
        <Button
          variant="secondary"
          label={COPY.shared.withObject(COPY.account.address.link, "send")}
          isBusy={isSending}
          onPress={() =>
            startSending(async () => {
              const answer = await answering(touched(resendChangeLink), router.refresh)(key);
              appToast(answer.ok ? "success" : "danger", answer.ok ? COPY.shared.toast.linkSent : (answer.reason ?? COPY.shared.toast.failure));
            })
          }
        />
      )}
      <ConfirmDialog
        verb="discard"
        subject={COPY.account.address.change}
        consequence={COPY.admin.addressChange.previousStays}
        facts={discardFacts}
        tone="danger"
        touch={{ holder }}
        onConfirm={() => discardChange(key)}
        trigger={
          <Button
            variant="quiet"
            label={COPY.shared.verb.discard}
          />
        }
      />
    </>
  );
}
