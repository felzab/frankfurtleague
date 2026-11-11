"use client";

import { useState } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusLine } from "./FieldParts";
import { statusLine } from "./fieldStyles";
import { editorBarLook } from "./railStyles";
import { tv } from "./tv";

import type { SaveQuestion } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FormStatus } from "./useFormAction";

/** The question the server held a save back for, and the person's two answers to it. */
export type BarQuestion = { asked: SaveQuestion | null; confirm: () => void; decline: () => void };

const pageLine = tv({
  slots: {
    // One line and no more: a part that does not fit beside the one before it wraps under it, out of the line's sight.
    line: statusLine({ placement: "row", tone: "changes", class: "flex h-5 flex-wrap content-start overflow-hidden whitespace-nowrap" }),
    text: "max-w-full min-w-0 truncate",
    // Its dot goes with it, a space's width either side.
    count: "ms-1 before:me-1 before:content-['·']",
  },
});

/**
 * The bar's line on a page that states something of its own there, such as how many a line-up names and how many
 * start: the page's text, then the count of unsaved changes after a dot, on one line. The text keeps its place: where
 * both do not fit, as on a phone, the count gives way whole, and a text wider than the line alone is cut with „…“. A
 * save with something to say, a refusal or „Gespeichert“, takes the whole line, wrapping as every status line does,
 * and the page's text returns with the next edit. Its live region stands from the first render and after the two
 * parts, so an outcome is announced and the region, empty beside them, never takes the line's first place.
 */
function PageLine({ text, status }: { text: Copy; status: FormStatus }) {
  const look = pageLine();
  const outcome = status !== null && status.tone !== "changes" ? status : null;
  return (
    <p className={outcome === null ? look.line() : statusLine({ placement: "row", tone: outcome.tone })}>
      {outcome === null && <span className={look.text()}>{text}</span>}
      {outcome === null && status !== null && <span className={look.count()}>{status.text}</span>}
      <span role="status">{outcome?.text}</span>
    </p>
  );
}

/**
 * The editor's one save: a bar at the bottom of the viewport, its hairline from the rail's separator to the edge, holding
 * over the editor's column the status line at its left once it has something to say and „Speichern“ at its right,
 * never disabled; on a phone it stands where the bottom bar stood. A save whose change reaches beyond the record, such as later results a match's new score
 * deletes, is held back by the server with its question, which the bar asks; confirmed, the save goes again.
 */
export function EditorBar({
  status,
  text,
  isPending,
  question,
  onSave,
}: {
  status: FormStatus;
  /** The page's own words on the status line, which a save's outcome takes the place of (`PageLine`). */
  text?: Copy;
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
  const look = editorBarLook();
  return (
    // A landmark of its own, named by its act: the bar stands after `main`, and content outside every landmark is
    // passed over by a screen reader moving between them.
    <div
      role="region"
      aria-label={COPY.shared.verb.save}
      className={look.bar()}>
      <div className={look.row()}>
        {text === undefined ? (
          <StatusLine
            status={status}
            placement="row"
          />
        ) : (
          <PageLine
            text={text}
            status={status}
          />
        )}
        <Button
          variant="primary"
          label={COPY.shared.verb.save}
          isBusy={isPending}
          onPress={onSave}
        />
      </div>
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
