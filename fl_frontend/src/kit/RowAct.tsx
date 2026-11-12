"use client";

import { COPY } from "@/core/copy";

import { ConfirmDialog } from "./ConfirmDialog";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Fact } from "./Facts";

/**
 * A row's act ending what the row shows: the word, in the outlined danger look every trigger of a destroying question
 * takes (`Trigger`), its question over the facts, then the passkey touch from the final press. A client module because a
 * server page cannot hand the question a closure binding its record: the page hands the server action and the record,
 * and this binds them.
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
  verb: "remove" | "withdraw" | "discard";
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
      trigger={{ label: COPY.shared.verb[verb] }}
    />
  );
}
