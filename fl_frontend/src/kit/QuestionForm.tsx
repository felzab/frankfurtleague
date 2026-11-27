"use client";

import { startTransition, useState } from "react";

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
import type { DoneVerb } from "./dialogAct";

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
 * The act the question's final press runs on the read's input. One on the touch's fixed list, as an erasure is, asks
 * the touch for the address the page was drawn for, the one account it may answer for, and posts that address as
 * `holder`; one off the list, as a withdrawal is, asks none.
 */
type QuestionRun<Input> =
  | { touch: { holder: string }; run: (input: NoInfer<Input> & { holder: string }) => Promise<ActionAnswer> }
  | { touch?: never; run: (input: NoInfer<Input>) => Promise<ActionAnswer> };

/**
 * A form that is a page's one act: its fields in a box, the act and its status line under them, no title but the page's.
 * The press sends the fields to `read`, whose answer is the question, worded from what it read, so the act is confirmed
 * over what it will reach: a question standing on data the form holds until the press. `read`'s refusal stands in the
 * form's line, no question asked. The question's final press asks the touch, for an act on its list, and calls `run`,
 * a refusal standing in the question's line (`ConfirmDialog`). A done act empties the boxes and names itself in the
 * question's toast, its answer's `note`.
 */
export function QuestionForm<Input>(
  props: {
    /** The act's verb, which its toast words as done where its answer brings no note. */
    verb: DoneVerb;
    /** The press's and the question's button alike. */
    tone: ConfirmWords["tone"];
    read: (formData: FormData) => Promise<ActionAnswer<AskedInput<Input>>>;
    /** The form's fields, the kit's, each with its `name`. */
    children: ReactNode;
  } & QuestionRun<Input>,
) {
  const { verb, tone, read, children } = props;
  const [asked, setAsked] = useState<AskedInput<Input> | null>(null);
  const [isAsking, setAsking] = useState(false);
  // Raised to draw the boxes anew, as `HeldForm` refuses a form's reset.
  const [emptied, setEmptied] = useState(0);

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
  // A read that opened the question says nothing here, being done: the question is its answer.
  const status = statusOf(answer, isBlocked, isPending);
  const open = { isOpen: isAsking, onOpenChange: setAsking };

  return (
    <>
      <HeldForm
        validationErrors={refused?.fieldErrors}
        onInvalid={block}
        isBusy={isPending}
        onSend={submit}
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
            isBusy={isPending}
          />
        </FormFooter>
      </HeldForm>
      {/* Mounted closed from the first render, the sign-in client's chunk with it (`usePasskeyTouch`): one mounted only
          once asked would mount open, and a remount closes the question it opens (`useOpenUntilHidden`). */}
      <ConfirmDialog
        question={
          asked === null
            ? null
            : {
                verb,
                tone,
                subject: asked.question.subject,
                consequence: asked.question.consequence,
                ...(asked.question.facts === undefined ? {} : { facts: asked.question.facts }),
              }
        }
        open={open}
        {...(props.touch === undefined ? {} : { touch: props.touch })}
        onConfirm={
          // Unasked, the question shows no button to press.
          asked === null
            ? () => undefined
            : async () => {
                const answered = await (props.touch === undefined
                  ? props.run(asked.input)
                  : props.run({ ...asked.input, holder: props.touch.holder }));
                // An update after the `await` lands outside the press's transition unless it opens one of its own.
                if (answered.ok) startTransition(() => setEmptied((count) => count + 1));
                return answered;
              }
        }
      />
    </>
  );
}
