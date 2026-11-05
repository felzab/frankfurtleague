"use client";

import { useState } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusLine } from "./FieldParts";

import type { SaveQuestion } from "@/core/action";
import type { FormStatus } from "./useFormAction";

/** The question the server held a save back for, and the person's two answers to it. */
export type BarQuestion = { asked: SaveQuestion | null; confirm: () => void; decline: () => void };

/**
 * The editor's one save: a bar at the bottom of the viewport, from the rail's separator to the edge, holding
 * the status line that is always there and „Speichern“, never disabled; on a phone it stands where the
 * bottom bar stood. A save whose change reaches beyond the record, such as later results a match's new score
 * deletes, is held back by the server with its question, which the bar asks; confirmed, the save goes again.
 */
export function EditorBar({
  status,
  isPending,
  question,
  onSave,
}: {
  status: FormStatus;
  isPending: boolean;
  question: BarQuestion;
  onSave: () => void;
}) {
  // The words of the last question asked, which the dialog keeps while it fades out. It stays mounted from the
  // first render, closed, as a held dialog must: one mounted open is closed again by its own cleanup.
  const [shown, setShown] = useState(question.asked);
  if (question.asked !== null && question.asked !== shown) setShown(question.asked);
  const held = {
    isOpen: question.asked !== null,
    onOpenChange: (isOpen: boolean) => {
      if (!isOpen) question.decline();
    },
  };
  return (
    // On desktop as tall as the rail's foot beside it (`--rail-foot`, from `tokens.css`), so the two top
    // hairlines are one line. A landmark of its own, named by its act: the bar stands after `main`, and content
    // outside every landmark is passed over by a screen reader moving between them.
    <div
      role="region"
      aria-label={COPY.shared.verb.save}
      className="sticky bottom-0 z-10 flex h-14 items-center gap-4 border-t border-border bg-bg px-4 lg:h-(--rail-foot) lg:px-8">
      <StatusLine
        status={status}
        placement="row"
      />
      <Button
        variant="primary"
        label={COPY.shared.verb.save}
        isBusy={isPending}
        onPress={onSave}
      />
      {/* One dialog in one place either way, so it keeps its state: before the first question it stands closed with
          nothing to say. */}
      {shown === null ? (
        <ConfirmDialog
          open={held}
          onConfirm={question.confirm}
        />
      ) : (
        <ConfirmDialog
          verb="save"
          subject={shown.subject}
          consequence={shown.consequence}
          {...(shown.facts === undefined ? {} : { facts: shown.facts })}
          tone="primary"
          open={held}
          onConfirm={question.confirm}
        />
      )}
    </div>
  );
}
