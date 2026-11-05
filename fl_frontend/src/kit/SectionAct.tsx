"use client";

import { startTransition, useState } from "react";

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

/**
 * An act standing in a section beside the fields it reads, as a Konto box holds its one act (`AccountBox`'s
 * `AccountAct`): its inputs, its button, and under the button the status line its outcome stands in, „Gespeichert“ or
 * its refusal. It stands inside an editor's own form, whose fields and save are another record's, so it sends what
 * its inputs hold as one typed object through `run`, never as a form; an act asking a question first answers a
 * refusal in the question's own line, and its done act here. `isDisabled` closes the button while its inputs are
 * incomplete, the section's fields showing what is missing.
 */
export function SectionAct({
  children,
  label,
  variant = "secondary",
  confirm,
  run,
  isDisabled = false,
}: {
  /** The act's inputs: the kit's fields, each holding its own value for `run` to read. */
  children?: ReactNode;
  label: Copy;
  variant?: "primary" | "secondary";
  confirm?: Question;
  run: () => Promise<ActionAnswer>;
  isDisabled?: boolean;
}) {
  const { answer, submit, isPending } = useFormAction(run, { resetOnLeave: true });
  // A question's act runs inside the question, which shows its refusal; the line here says only that it was done.
  const [confirmed, setConfirmed] = useState(false);
  const status: FormStatus =
    confirm === undefined ? statusOf(answer, false, isPending) : confirmed ? { tone: "saved", text: COPY.shared.saved } : null;

  return (
    <>
      {children}
      {confirm === undefined ? (
        <Button
          variant={variant}
          label={label}
          isBusy={isPending}
          isDisabled={isDisabled}
          onPress={() => submit(undefined)}
        />
      ) : (
        <ConfirmDialog
          {...confirm}
          onConfirm={async () => {
            setConfirmed(false);
            const answered = await run();
            // An update after the `await` commits outside the press's transition unless it opens one of its own.
            if (answered.ok) startTransition(() => setConfirmed(true));
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
