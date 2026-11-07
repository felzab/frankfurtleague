"use client";

import { Button } from "@/kit/Button";
import { ConfirmDialog } from "@/kit/ConfirmDialog";

import { COPY } from "@/core/copy";

import { liftBan } from "./banActs";

const WORDS = COPY.admin.banList;

/** A ban's act on its row: „Entfernen“, asked once over the address and the Grund, then the passkey touch. */
export function LiftBan({
  id,
  address,
  reason,
  holder,
}: {
  id: string;
  address: string;
  reason: string;
  /** The address the page was drawn for, which an act behind the passkey touch posts. */
  holder: string;
}) {
  return (
    <ConfirmDialog
      verb="remove"
      subject={WORDS.object}
      consequence={WORDS.liftConsequence}
      facts={[
        { label: COPY.signIn.address, value: { record: address } },
        { label: COPY.admin.spiel.reason, value: { record: reason } },
      ]}
      tone="danger"
      touch={{ holder }}
      onConfirm={() => liftBan({ id, holder })}
      trigger={
        <Button
          variant="secondary"
          label={COPY.shared.verb.remove}
        />
      }
    />
  );
}
