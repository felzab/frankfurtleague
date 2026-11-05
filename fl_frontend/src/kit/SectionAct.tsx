"use client";

import { startTransition, useLayoutEffect, useState } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusLine } from "./FieldParts";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmDialogProps } from "./ConfirmDialog";
import type { FormStatus } from "./useFormAction";

/** The question an act asks before it runs; its button then carries the question's verb and tone. */
type Question = Omit<ConfirmDialogProps, "trigger" | "open" | "onConfirm">;

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
 * would reach nobody.
 */
export function SectionAct({
  children,
  label,
  variant = "secondary",
  confirm,
  run,
  inputs = NO_INPUTS,
  isDisabled = false,
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
}) {
  const { answer, submit, isPending } = useFormAction(run, { resetOnLeave: true });
  // The inputs of the last press, whose answer the line shows only while they still hold.
  const [pressedOn, setPressedOn] = useState(inputs);
  // A question's act runs inside the question, which shows its refusal; the line here says only that it was done, in the
  // act's own note where it moved more than its box shows, as every done answer is worded (`statusOf`).
  const [done, setDone] = useState<Copy | null>(null);
  // Cleared as Next hides the page, as `useFormAction` clears the answer the other branch shows.
  useLayoutEffect(() => () => setDone(null), []);
  const answered: FormStatus =
    confirm === undefined ? statusOf(answer, false, isPending) : done === null ? null : { tone: "saved", text: done };
  const status = sameInputs(inputs, pressedOn) ? answered : null;

  return (
    <>
      {children}
      {confirm === undefined ? (
        <Button
          variant={variant}
          label={label}
          isBusy={isPending}
          isDisabled={isDisabled}
          onPress={() => {
            setPressedOn(inputs);
            submit(undefined);
          }}
        />
      ) : (
        <ConfirmDialog
          {...confirm}
          onConfirm={async () => {
            setDone(null);
            setPressedOn(inputs);
            const answered = await run();
            // An update after the `await` lands outside the press's transition unless it opens one of its own.
            if (answered.ok) startTransition(() => setDone(answered.note ?? COPY.shared.saved));
            return answered;
          }}
          trigger={
            <Button
              variant={variant}
              label={label}
              isDisabled={isDisabled}
            />
          }
        />
      )}
      <StatusLine
        status={status}
        placement="column"
      />
    </>
  );
}
