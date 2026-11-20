"use client";

import { useState } from "react";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { actLabel } from "./dialogAct";
import { useLocked } from "./draftUnsaved";
import { FormFooter } from "./FormFooter";
import { toastAnswer } from "./Toast";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";
import type { ActWords, DoneVerb } from "./dialogAct";

/** An act that sends: its write, a refusal answering in the footer's status line and a done act in its toast. */
type Sending = {
  /** The act, whose verb and object name its button and whose verb words its toast once done. */
  act: ActWords<DoneVerb>;
  run: () => Promise<ActionAnswer>;
  label?: never;
  press?: never;
} & (
  | {
      variant?: "primary" | "secondary";
      /** The question it asks before it runs; its button then carries the question's verb and tone. */
      confirm?: ConfirmWords & { tone: "primary" };
    }
  // An act that destroys takes the outlined danger look its question's trigger takes everywhere (`Trigger`).
  | { variant?: never; confirm: ConfirmWords & { tone: "danger" } }
);

/**
 * An act that writes nothing and runs at once, such as copying a link the section shows: a secondary button whose
 * outcome is its own toast, so the status line, which speaks of the section's writes, stays as it was.
 */
type AtOnce = { label: Copy; press: () => void; act?: never; run?: never; variant?: never; confirm?: never };

export type SectionActItem = {
  /** Closed while the section's inputs are incomplete, its fields showing what is missing, or while the press would reach nobody. */
  isDisabled?: boolean;
  /** Why its write would refuse the record as it stands, which the page read, the button saying why. */
  locked?: Copy;
} & (Sending | AtOnce);

const NO_INPUTS: ReadonlyArray<unknown> = [];

/** Whether the inputs hold what they held at the press, each compared as a hook's dependencies are. */
const sameInputs = (now: ReadonlyArray<unknown>, then: ReadonlyArray<unknown>) =>
  now.length === then.length && now.every((value, index) => Object.is(value, then[index]));

/** What a press hands the one form action: the pressed act's `run`, and its verb, which words its toast once done. */
type Press = { run: () => Promise<ActionAnswer>; verb: DoneVerb };

/** One act's button, behind its question where it asks one; its own component, since its lock is read by a hook. */
function ActButton({ item, isBusy, onPress }: { item: SectionActItem; isBusy: boolean; onPress: () => void }) {
  const reason = useLocked(item.locked);
  if (item.press !== undefined)
    return (
      <Button
        variant="secondary"
        label={item.label}
        isDisabled={item.isDisabled ?? false}
        locked={reason}
        onPress={item.press}
      />
    );
  const { confirm } = item;
  const label = actLabel(item.act);
  if (confirm === undefined)
    return (
      <Button
        variant={item.variant ?? "secondary"}
        label={label}
        isBusy={isBusy}
        isDisabled={item.isDisabled ?? false}
        locked={reason}
        onPress={onPress}
      />
    );
  return (
    <ConfirmDialog
      question={confirm}
      onConfirm={() => {
        onPress();
        return item.run();
      }}
      trigger={{ label, variant: item.variant, isDisabled: item.isDisabled ?? false, locked: reason }}
    />
  );
}

/**
 * The acts standing in an editor's section beside the fields they read, as a Konto box holds its one act (`AccountBox`):
 * its inputs, then the section's footer strip (`FormFooter`), which closes the box, its acts at the right end and the
 * status line a refusal of its last press stands in at the left. It stands last in its section. It stands inside an
 * editor's own form, whose fields and save are another record's, so each act sends what its inputs hold as one typed
 * object through `run`, never as a form. A done act says itself in a toast, its answer's note or its verb's done word,
 * so the line adds no row a phone's page would move by; an act asking a question first answers a refusal in the
 * question's own line, and its done act in the question's toast. A refusal speaks of the inputs it was pressed on: it
 * goes once one of `inputs` changes, and once the page is left. Inside an editor whose draft holds unsaved changes
 * every act is closed as a locked one is (`useLocked`).
 */
export function SectionAct({
  children,
  acts,
  inputs = NO_INPUTS,
}: {
  /** The acts' inputs: the kit's fields, each holding its own value for `run` to read. */
  children?: ReactNode;
  /** The section's acts, equal, none the main one: in the order they are read, which they keep at every width (`FormFooter`). */
  acts: readonly [...SectionActItem[], SectionActItem];
  /** The values the acts' `run` reads; none for acts taking no input. */
  inputs?: ReadonlyArray<unknown>;
}) {
  // One answer for every plain act, cleared as Next hides the page; a question's act runs inside its question, which
  // shows its refusal and says its done act in a toast, so its press only clears the line of the act before.
  const { answer, submit, reset, isPending } = useFormAction(
    async ({ run, verb }: Press) => {
      const answered = await run();
      if (answered.ok) toastAnswer(answered, COPY.shared.toast.done[verb]);
      return answered;
    },
    { resetOnLeave: true },
  );
  // The inputs of the last press, whose refusal the line shows only while they still hold, and the act pressed.
  const [pressed, setPressed] = useState({ on: inputs, at: 0 });
  const status = answer?.ok === true || !sameInputs(inputs, pressed.on) ? null : statusOf(answer, false, isPending);

  return (
    <>
      {children}
      <FormFooter
        place="section"
        status={status}>
        {acts.map((item, at) => (
          <ActButton
            key={at}
            item={item}
            isBusy={isPending && pressed.at === at}
            onPress={() => {
              setPressed({ on: inputs, at });
              // An act at once never calls this: its button runs it alone.
              if (item.run === undefined) return;
              if (item.confirm === undefined) submit({ run: item.run, verb: item.act.verb });
              else reset();
            }}
          />
        ))}
      </FormFooter>
    </>
  );
}
