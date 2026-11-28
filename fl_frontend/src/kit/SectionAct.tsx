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
  /** The done act's toast where its verb's done word does not say it, such as „Link gesendet“ for a link sent. */
  done?: Copy;
  run: () => Promise<ActionAnswer>;
  label?: never;
  press?: never;
  /**
   * The question it asks before it runs; its button then carries the question's verb and tone. An act that destroys
   * takes the outlined danger look its question's trigger takes everywhere (`Trigger`).
   */
  confirm?: ConfirmWords<DoneVerb>;
};

/**
 * An act that writes nothing and runs at once, such as copying a link the section shows: a secondary button whose
 * outcome is its own toast, so the status line, which speaks of the section's writes, stays as it was.
 */
type AtOnce = { label: Copy; press: () => void; act?: never; done?: never; run?: never; confirm?: never };

export type SectionActItem = {
  /**
   * Why its write would refuse the record as it stands, which the page read, or why the press cannot run yet, such as
   * inputs still incomplete or nobody it would reach: the button saying why, reachable rather than mute; `true` where
   * the editor's lock line already says it, the button locked with no reason of its own.
   */
  locked?: Copy | true;
} & (Sending | AtOnce);

const NO_INPUTS: ReadonlyArray<unknown> = [];

/** Whether the inputs hold what they held at the press, each compared as a hook's dependencies are. */
const sameInputs = (now: ReadonlyArray<unknown>, then: ReadonlyArray<unknown>) =>
  now.length === then.length && now.every((value, index) => Object.is(value, then[index]));

/** What a press hands the one form action: the pressed act's `run`, and the word its toast says once done. */
type Press = { run: () => Promise<ActionAnswer>; done: Copy };

/** One act's button, behind its question where it asks one; its own component, since its lock is read by a hook. */
function ActButton({ item, isBusy, onPress }: { item: SectionActItem; isBusy: boolean; onPress: () => void }) {
  // A lock the lock line says wins over the unsaved draft's reason, since a save would not open it.
  const reason = useLocked(item.locked === true ? undefined : item.locked);
  const lock = item.locked === true ? true : reason;
  if (item.press !== undefined)
    return (
      <Button
        variant="secondary"
        label={item.label}
        locked={lock}
        onPress={item.press}
      />
    );
  const { confirm } = item;
  const label = actLabel(item.act);
  if (confirm === undefined)
    return (
      <Button
        variant="secondary"
        label={label}
        isBusy={isBusy}
        locked={lock}
        onPress={onPress}
      />
    );
  return (
    <ConfirmDialog
      question={confirm}
      done={item.done ?? COPY.shared.toast.done[confirm.verb]}
      onConfirm={() => {
        onPress();
        return item.run();
      }}
      trigger={{ label, locked: lock }}
    />
  );
}

/**
 * The acts standing in an editor's section beside the fields they read, as a Konto box holds its one act (`AccountBox`):
 * its inputs, then the section's footer strip (`FormFooter`), which closes the box, its acts at the right end and the
 * status line a refusal of its last press stands in at the left. It stands last in its section; with no inputs, and
 * nothing else in the box's padding, the strip stands first there and meets the rule above it. It stands inside an
 * editor's own form, whose fields and save are another record's, so each act sends what its inputs hold as one typed
 * object through `run`, never as a form. A done act says itself in a toast, its answer's note, else its own `done` or
 * its verb's done word, so the line adds no row a phone's page would move by; an act asking a question first answers
 * a refusal in the question's own line, and its done act in the question's toast. A refusal speaks of the inputs it
 * was pressed on: it goes once one of `inputs` changes, and once the page is left. Inside an editor whose draft holds
 * unsaved changes every act is closed as a locked one is (`useLocked`).
 *
 * Its answer carries no field fault, so its inputs stand outside every form's faults and the line words a refusal by
 * its reason. An act taking its record from the page's address has no box to fault, and the acts reading inputs, a
 * group swap and a replacement, offer only the clubs their write takes, so a pair the write refuses comes from a page
 * gone stale, which the backend refuses as a gate and the stale line answers.
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
    async ({ run, done }: Press) => {
      const answered = await run();
      if (answered.ok) toastAnswer(answered, done);
      return answered;
    },
    { resetOnLeave: true },
  );
  // The inputs of the last press, whose refusal the line shows only while they still hold, and the act pressed.
  const [pressed, setPressed] = useState({ on: inputs, at: 0 });
  const status = sameInputs(inputs, pressed.on) ? statusOf(answer, false, isPending) : null;

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
              if (item.confirm === undefined) submit({ run: item.run, done: item.done ?? COPY.shared.toast.done[item.act.verb] });
              else reset();
            }}
          />
        ))}
      </FormFooter>
    </>
  );
}
