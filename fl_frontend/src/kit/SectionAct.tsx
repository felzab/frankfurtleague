"use client";

import { useState } from "react";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { useLocked } from "./draftUnsaved";
import { StatusLine } from "./FieldParts";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";

/** The question an act asks before it runs; its button then carries the question's verb and tone. */
type Question = ConfirmWords;

const NO_INPUTS: ReadonlyArray<unknown> = [];

/** Whether the inputs hold what they held at the press, each compared as a hook's dependencies are. */
const sameInputs = (now: ReadonlyArray<unknown>, then: ReadonlyArray<unknown>) =>
  now.length === then.length && now.every((value, index) => Object.is(value, then[index]));

/**
 * An act standing in a section beside the fields it reads, as a Konto box holds its one act (`AccountBox`'s
 * `AccountAct`): its inputs, its button, and under the button the status line its outcome stands in, „Gespeichert“ or
 * its refusal. The line stands under the button where a Konto box's footer sets it beside: the act has no footer of
 * its own, its button standing at its own width in the section's column of fields, and an act standing in a column
 * takes its line beneath, as the one-shot submit's and the sign-in's do. It stands inside an editor's own form, whose
 * fields and save are another record's, so it sends what its inputs hold as one typed object through `run`, never as a
 * form; an act asking a question first answers a refusal in the question's own line, and its done act here, in the
 * act's own note where it has one. A done line speaks of the inputs it was pressed on: it goes once one of `inputs`
 * changes, as the editor's bar trades its „Gespeichert“ for the next edit, and once the page is left. `isDisabled`
 * closes the button while its inputs are incomplete, the section's fields showing what is missing, or while the press
 * would reach nobody. `locked` closes it where its write would refuse the record as it stands, which the page read, the
 * button saying why (`Button`); inside an editor whose draft holds unsaved changes the act is closed the same way
 * (`useLocked`).
 */
export function SectionAct({
  children,
  label,
  variant = "secondary",
  confirm,
  run,
  inputs = NO_INPUTS,
  isDisabled = false,
  locked,
}: {
  /** The act's inputs: the kit's fields, each holding its own value for `run` to read. */
  children?: ReactNode;
  label: Copy;
  variant?: "primary" | "secondary";
  confirm?: Question;
  run: () => Promise<ActionAnswer>;
  /** The values `run` reads; none for an act taking no input. */
  inputs?: ReadonlyArray<unknown>;
  isDisabled?: boolean;
  locked?: Copy;
}) {
  // One answer for either kind of act, cleared as Next hides the page: a plain act runs here; a question's act runs
  // inside its question, which shows its refusal, and hands its done answer over to stand in the line.
  const { answer, submit, isPending } = useFormAction((ran: ActionAnswer | undefined) => (ran === undefined ? run() : Promise.resolve(ran)), {
    resetOnLeave: true,
  });
  // The inputs of the last press, whose answer the line shows only while they still hold.
  const [pressedOn, setPressedOn] = useState(inputs);
  const status = sameInputs(inputs, pressedOn) ? statusOf(answer, false, isPending) : null;
  const reason = useLocked(locked);
  const button = (
    <Button
      variant={variant}
      label={label}
      isBusy={confirm === undefined && isPending}
      isDisabled={isDisabled}
      locked={reason}
      lockedEdge="start"
      onPress={
        confirm === undefined
          ? () => {
              setPressedOn(inputs);
              submit(undefined);
            }
          : undefined
      }
    />
  );

  return (
    <>
      {children}
      {confirm === undefined || reason !== undefined ? (
        button
      ) : (
        <ConfirmDialog
          {...confirm}
          onConfirm={async () => {
            setPressedOn(inputs);
            const answered = await run();
            if (answered.ok) submit(answered);
            return answered;
          }}
          trigger={button}
        />
      )}
      <StatusLine
        status={status}
        placement="column"
      />
    </>
  );
}
