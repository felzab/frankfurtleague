"use client";

import { startTransition, useLayoutEffect, useState, useTransition } from "react";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { cardSurface } from "./cardStyles";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldStack } from "./FieldStack";
import { FormFooter } from "./FormFooter";
import { HeldForm } from "./HeldForm";
import { formColumn } from "./RailFrame";
import { boxHead } from "./Section";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";
import type { TouchVerb } from "./dialogAct";
import type { FormStatus } from "./useFormAction";

/**
 * One box as wide as the sign-in's column from `lg`, its fields filling it, a page that is one question reading as that
 * page does; its act in the box's strip, as a Konto box's.
 */
const BOX_CLASSES = formColumn({ class: cardSurface({ class: "gap-0 overflow-hidden lg:max-w-signin" }) });

const CONTENT_CLASSES = boxHead().content();

/** What the press read: the question's words, and the input the final press sends as the read held it to its rules. */
export type AskedInput<Input> = {
  question: Pick<ConfirmWords, "subject" | "consequence" | "facts">;
  input: Input;
};

/**
 * A form that is a page's one act: its fields in a box, the act and its status line under them, no title but the page's.
 * The press sends the fields to `read`, whose answer is the question, worded from what it read, so the act is confirmed
 * over what it will reach: a question standing on data the form holds until the press. `read`'s refusal stands in the
 * form's line, no question asked. The question's final press closes it, asks the touch and calls `run`, the form's
 * press busy until it answers, a refusal in a toast (`ConfirmDialog`); an act off the touch's list runs inside the
 * question instead, a refusal standing in the question's line. A done act names itself in its answer's `note`, which
 * stands in the form's line over boxes drawn empty, and in that line alone.
 */
export function QuestionForm<Input>({
  verb,
  tone,
  touch = true,
  read,
  run,
  holder,
  children,
}: {
  /** The act's verb, one its toast words as done where the touch is asked. */
  verb: TouchVerb;
  /** The press's and the question's button alike. */
  tone: ConfirmWords["tone"];
  /** Whether the act is on the touch's fixed list, as an erasure is and a withdrawal is not. */
  touch?: boolean;
  read: (formData: FormData) => Promise<ActionAnswer<AskedInput<Input>>>;
  run: (input: Input & { holder: string }) => Promise<ActionAnswer>;
  /** The address the page was drawn for, the one account the touch may answer for. */
  holder: string;
  /** The form's fields, the kit's, each with its `name`. */
  children: ReactNode;
}) {
  const [asked, setAsked] = useState<AskedInput<Input> | null>(null);
  const [isAsking, setAsking] = useState(false);
  // The act runs after its question closed, so the form's press shows it running and sends nothing while it does.
  const acting = useTransition();
  const [isActing] = acting;
  // Raised to draw the boxes anew, as `HeldForm` refuses a form's reset.
  const [emptied, setEmptied] = useState(0);

  // What a done act said, the question having closed with its own line. Gone as the page hides, as a form's answer is.
  const [done, setDone] = useState<FormStatus>(null);
  useLayoutEffect(() => () => setDone(null), []);

  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    async (press: FormData): Promise<ActionAnswer> => {
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
  const status = done ?? (answer?.ok === true ? null : statusOf(answer, isBlocked, isPending));
  const open = { isOpen: isAsking, onOpenChange: setAsking };
  // Typed as the two shapes it takes, since two object literals in one conditional widen to one with both keys optional.
  const touched: { touch: { holder: string }; doneShown: true } | { touch?: never; doneShown?: never } = touch
    ? { touch: { holder }, doneShown: true }
    : {};

  return (
    <>
      <HeldForm
        validationErrors={refused?.fieldErrors}
        onInvalid={block}
        // A done act's line is about the boxes it emptied: what is typed next is another act's.
        onEdit={() => setDone(null)}
        onSend={(formData) => {
          if (isPending || isActing) return;
          setDone(null);
          submit(formData);
        }}
        className={BOX_CLASSES}>
        <div className={CONTENT_CLASSES}>
          <FieldStack key={emptied}>{children}</FieldStack>
        </div>
        <FormFooter
          place="strip"
          status={status}>
          <Button
            // The press asks the question first, so an act that destroys keeps the red fill for the question's button.
            variant={tone === "danger" ? askingLook(tone) : tone}
            type="submit"
            label={COPY.shared.verb[verb]}
            isBusy={isPending || isActing}
          />
        </FormFooter>
      </HeldForm>
      {/* Mounted closed from the first render, the sign-in client's chunk with it (`usePasskeyTouch`), and one component
          type in both arms: a swapped one would unmount, and its unmount closes the question it opens
          (`useOpenUntilHidden`). */}
      {asked === null ? (
        <ConfirmDialog
          open={open}
          transition={acting}
          onConfirm={() => undefined}
          {...(touch ? { touch: { holder } } : {})}
        />
      ) : (
        <ConfirmDialog
          verb={verb}
          tone={tone}
          subject={asked.question.subject}
          consequence={asked.question.consequence}
          {...(asked.question.facts === undefined ? {} : { facts: asked.question.facts })}
          open={open}
          transition={acting}
          // Without the touch the question shows a refusal itself and closes on a done act, which the form's line names.
          {...touched}
          onConfirm={async () => {
            const answered = await run({ ...asked.input, holder });
            // An update after the `await` lands outside the press's transition unless it opens one of its own.
            if (answered.ok) {
              startTransition(() => {
                setEmptied((count) => count + 1);
                setDone(statusOf(answered, false, false));
              });
            }
            return answered;
          }}
        />
      )}
    </>
  );
}
