"use client";

import { Button } from "@/kit/Button";
import { ConfirmDialog } from "@/kit/ConfirmDialog";

import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Fact } from "@/kit/Facts";

/**
 * A row's one act for the owner: the word, its question over the facts, then the passkey touch from the final press.
 * „Entfernen“ stands quiet on a row of the list and „Zurückziehen“ as a button on what waits, as the board draws them.
 */
export function RowAct({
  verb,
  subject,
  consequence,
  facts,
  act,
  id,
  holder,
}: {
  verb: "remove" | "withdraw";
  subject: Copy;
  consequence: Copy;
  facts: ReadonlyArray<Fact>;
  /** The server action, which takes the row's record and the address the page was drawn for. */
  act: (input: { id: string; holder: string }) => Promise<ActionAnswer>;
  id: string;
  holder: string;
}) {
  return (
    <ConfirmDialog
      verb={verb}
      subject={subject}
      consequence={consequence}
      facts={facts}
      tone="danger"
      touch={{ holder }}
      onConfirm={() => act({ id, holder })}
      trigger={
        <Button
          variant={verb === "remove" ? "quiet" : "secondary"}
          label={COPY.shared.verb[verb]}
        />
      }
    />
  );
}
