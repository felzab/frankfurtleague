"use client";

import { useState } from "react";

import { LINE_SEPARATOR } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

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
    // Its separator goes with it. Kept whole, since a flex item drops the space it opens with.
    count: "whitespace-pre",
  },
});

/**
 * The bar's line on a page that states something of its own there, such as how many a line-up names and how many
 * start: the page's text, then the count of unsaved changes after a dot, on one line. The text keeps its place: where
 * both do not fit, as on a phone, the count gives way whole, and a text wider than the line alone is cut with „…“. A
 * save with something to say, a refusal or „Gespeichert“, takes the whole line in the status line's region, wrapping
 * as every status line does, and the page's text returns with the next edit.
 */
function PageLine({ text, status }: { text: Copy; status: FormStatus }) {
  const look = pageLine();
  const isOutcome = status !== null && status.tone !== "changes";
  return (
    <>
      {!isOutcome && (
        <p className={look.line()}>
          <span className={look.text()}>{text}</span>
          {status !== null && (
            <span className={look.count()}>
              {LINE_SEPARATOR}
              {status.text}
            </span>
          )}
        </p>
      )}
      <StatusLine
        status={isOutcome ? status : null}
        placement="row"
      />
    </>
  );
}

/**
 * The editor's one save: a bar at the bottom of the viewport holding the status line once it has something to say and
 * „Speichern“, never disabled. A save whose change reaches beyond the record, such as later results a match's new score
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
  /** The page's own words on the status line, which a save's outcome takes the place of. */
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
    // A landmark of its own, named by its act, at the foot of `main`: a screen reader moving between landmarks reaches
    // the save without passing through the page's content.
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
      {/* Mounted from the first render, so it keeps its state: before the first question it stands closed with nothing
          to say. */}
      <ConfirmDialog
        question={
          shown === null
            ? null
            : {
                verb: "save",
                subject: shown.subject,
                consequence: shown.consequence,
                ...(shown.facts === undefined ? {} : { facts: shown.facts }),
                tone: "primary",
              }
        }
        open={held}
        onConfirm={question.confirm}
      />
    </div>
  );
}
