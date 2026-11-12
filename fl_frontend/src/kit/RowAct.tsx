"use client";

import { useState } from "react";

import { COPY } from "@/core/copy";

import { ConfirmDialog } from "./ConfirmDialog";
import { SideActs } from "./SideActs";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Fact } from "./Facts";

/**
 * A row's act ending what the row shows, its one side act (`SideActs`), in the form its list decides: its labelled
 * button in the outlined danger look, or its entry in the row's „⋯“, either opening its question over the facts, then
 * the passkey touch from the question's final press. Where it cannot run on the row as it stands, it is listed all the
 * same, locked with its reason. A row standing in a `Table` says it carries one side act (`sideActs`). A client module
 * because a server page cannot hand the question a closure binding its record: the page hands the server action and
 * the record, and this binds them.
 */
export function RowAct({
  verb,
  subject,
  consequence,
  facts,
  act,
  id,
  holder,
  locked,
}: {
  verb: "remove" | "withdraw" | "discard";
  subject: Copy;
  consequence: Copy;
  facts: ReadonlyArray<Fact>;
  /** The server action, which takes the row's record and the address the page was drawn for. */
  act: (input: { id: string; holder: string }) => Promise<ActionAnswer>;
  id: string;
  holder: string;
  /** Why the act cannot run on this row, such as on the reader's own: its button or its entry says so, and asks nothing. */
  locked?: Copy;
}) {
  const [isAsking, setAsking] = useState(false);
  return (
    <SideActs
      acts={[
        {
          label: COPY.shared.verb[verb],
          tone: "danger",
          ...(locked === undefined ? {} : { locked }),
          onPress: () => setAsking(true),
        },
      ]}>
      <ConfirmDialog
        verb={verb}
        subject={subject}
        consequence={consequence}
        facts={facts}
        tone="danger"
        touch={{ holder }}
        onConfirm={() => act({ id, holder })}
        open={{ isOpen: isAsking, onOpenChange: setAsking }}
      />
    </SideActs>
  );
}
