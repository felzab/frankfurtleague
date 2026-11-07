"use client";

import { Fragment, startTransition, useState } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { buttonPlaceholder } from "./buttonStyles";
import { cardSurface } from "./cardStyles";
import { ConfirmDialog } from "./ConfirmDialog";
import { ActRow } from "./Dialog";
import { StatusLine } from "./FieldParts";
import { statusLine } from "./fieldStyles";
import { HeldForm } from "./HeldForm";
import { formColumn } from "./RailFrame";
import { Waiting } from "./Skeleton";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Verb } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";

/** The form column as one box, the fields at their own widths in it. */
const BOX_CLASSES = formColumn({ class: cardSurface({ class: "justify-items-start gap-4 p-4" }) });
/** The row of the act and its status line, filling the box, which sets every other child at its own width. */
const ROW_CLASSES = "w-full";

/** What the press read: the question's words, and the input the final press sends as the read held it to its rules. */
export type AskedInput<Input> = {
  question: Pick<ConfirmWords, "subject" | "consequence" | "facts">;
  input: Input;
};

/**
 * A form that is a page's one act: its fields in a box, the act and its status line under them, no title but the page's.
 * The press sends the fields to `read`, whose answer is the question, worded from what it read, so the act is confirmed
 * over what it will reach: a question standing on data the form holds until the press. `read`'s refusal stands in the
 * form's line, no question asked. The question's final press asks the touch and runs `act`, which answers in the
 * question's own line while it stays open. A done act names itself in its answer's `note`, which stands in the form's
 * line over boxes drawn empty.
 */
export function QuestionForm<Input>({
  verb,
  tone,
  read,
  act,
  holder,
  children,
}: {
  verb: Verb;
  /** The press's and the question's button alike. */
  tone: ConfirmWords["tone"];
  read: (formData: FormData) => Promise<ActionAnswer<AskedInput<Input>>>;
  act: (input: Input & { holder: string }) => Promise<ActionAnswer>;
  /** The address the page was drawn for: the act is on the touch's list (`usePasskeyTouch`). */
  holder: string;
  /** The form's fields, the kit's, each with its `name`. */
  children: ReactNode;
}) {
  const [asked, setAsked] = useState<AskedInput<Input> | null>(null);
  const [isAsking, setAsking] = useState(false);
  // Raised to draw the boxes anew, as `HeldForm` refuses a form's reset.
  const [emptied, setEmptied] = useState(0);

  // The press's read through the one form wrapper, and the act's done answer handed in to stand on the same line.
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    async (press: FormData | ActionAnswer): Promise<ActionAnswer> => {
      if (!(press instanceof FormData)) return press;
      const answered = await read(press);
      if (!answered.ok) return answered;
      // A form's action runs in a transition, and an update after its `await` commits outside it.
      startTransition(() => {
        setAsked(answered.value);
        setAsking(true);
      });
      return { ok: true, value: undefined };
    },
    { resetOnLeave: true },
  );
  const refused = answer !== null && !answer.ok ? answer : null;
  // A read that opened the question says nothing here: the question is its answer.
  const status = answer?.ok === true && answer.note === undefined ? null : statusOf(answer, isBlocked, isPending);
  const open = { isOpen: isAsking, onOpenChange: setAsking };

  return (
    <>
      <HeldForm
        validationErrors={refused?.fieldErrors}
        onInvalid={block}
        onSend={(formData) => {
          if (!isPending) submit(formData);
        }}
        className={BOX_CLASSES}>
        <Fragment key={emptied}>{children}</Fragment>
        <div className={ROW_CLASSES}>
          <ActRow>
            <StatusLine
              status={status}
              placement="row"
            />
            <Button
              variant={tone}
              type="submit"
              label={COPY.shared.verb[verb]}
              isBusy={isPending}
            />
          </ActRow>
        </div>
      </HeldForm>
      {/* Mounted closed from the first render, the sign-in client's chunk with it (`usePasskeyTouch`), and one component
          type in both arms: a swapped one would unmount, and its unmount closes the question it opens
          (`useOpenUntilHidden`). */}
      {asked === null ? (
        <ConfirmDialog
          open={open}
          onConfirm={() => undefined}
          touch={{ holder }}
        />
      ) : (
        <ConfirmDialog
          verb={verb}
          tone={tone}
          subject={asked.question.subject}
          consequence={asked.question.consequence}
          {...(asked.question.facts === undefined ? {} : { facts: asked.question.facts })}
          open={open}
          touch={{ holder }}
          onConfirm={async () => {
            const answered = await act({ ...asked.input, holder });
            if (answered.ok) {
              setEmptied((count) => count + 1);
              submit(answered);
            }
            return answered;
          }}
        />
      )}
    </>
  );
}

/** A `QuestionForm` while what it needs is read: the placeholders of its fields, then its act's. */
export function QuestionFormPlaceholder({ verb, children }: { verb: Verb; children: ReactNode }) {
  return (
    <Waiting layout={BOX_CLASSES}>
      {children}
      <div className={ROW_CLASSES}>
        <ActRow>
          <span className={statusLine({ placement: "row", tone: "none" })} />
          <span className={buttonPlaceholder()}>{COPY.shared.verb[verb]}</span>
        </ActRow>
      </div>
    </Waiting>
  );
}
