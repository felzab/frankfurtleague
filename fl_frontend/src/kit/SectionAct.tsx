"use client";

import { useState } from "react";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { ConfirmDialog } from "./ConfirmDialog";
import { useLocked } from "./draftUnsaved";
import { FormFooter } from "./FormFooter";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";

/** An act that sends: its write, answering in the footer's status line. */
type Sending = { run: () => Promise<ActionAnswer>; press?: never } & (
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
type AtOnce = { press: () => void; run?: never; variant?: never; confirm?: never };

/** One act of a section's footer. */
export type SectionActItem = {
  label: Copy;
  /** Closed while the section's inputs are incomplete, its fields showing what is missing, or while the press would reach nobody. */
  isDisabled?: boolean;
  /** Why its write would refuse the record as it stands, which the page read, the button saying why (`Button`). */
  locked?: Copy;
} & (Sending | AtOnce);

const NO_INPUTS: ReadonlyArray<unknown> = [];

/** Whether the inputs hold what they held at the press, each compared as a hook's dependencies are. */
const sameInputs = (now: ReadonlyArray<unknown>, then: ReadonlyArray<unknown>) =>
  now.length === then.length && now.every((value, index) => Object.is(value, then[index]));

/** What a press hands the one form action: the pressed act's `run`, or the answer a question's act reached inside it. */
type Press = () => Promise<ActionAnswer>;

/** One act's button, behind its question where it asks one; its own component, since its lock is read by a hook. */
function ActButton({
  act,
  isBusy,
  onPress,
  onAnswered,
}: {
  act: SectionActItem;
  isBusy: boolean;
  onPress: () => void;
  onAnswered: (ran: ActionAnswer) => void;
}) {
  const reason = useLocked(act.locked);
  if (act.press !== undefined)
    return (
      <Button
        variant="secondary"
        label={act.label}
        isDisabled={act.isDisabled ?? false}
        locked={reason}
        onPress={act.press}
      />
    );
  const { confirm } = act;
  if (confirm === undefined || reason !== undefined)
    return (
      <Button
        // A locked act that destroys keeps the one outlined danger look its question's trigger takes everywhere.
        variant={confirm?.tone === "danger" ? askingLook(confirm.tone) : (act.variant ?? "secondary")}
        label={act.label}
        isBusy={confirm === undefined && isBusy}
        isDisabled={act.isDisabled ?? false}
        locked={reason}
        onPress={confirm === undefined ? onPress : undefined}
      />
    );
  return (
    <ConfirmDialog
      {...confirm}
      onConfirm={async () => {
        onPress();
        const answered = await act.run();
        if (answered.ok) onAnswered(answered);
        return answered;
      }}
      trigger={{ label: act.label, variant: act.variant, isDisabled: act.isDisabled ?? false }}
    />
  );
}

/**
 * The acts standing in an editor's section beside the fields they read, as a Konto box holds its one act (`AccountBox`):
 * its inputs, then the section's footer strip (`FormFooter`), which closes the box, its acts at the right end and the
 * status line its last press's outcome stands in at the left, „Gespeichert“ or its refusal. It stands last in its
 * section. It stands inside an editor's own form, whose fields and save are another record's, so each act sends what its
 * inputs hold as one typed object through `run`, never as a form; an act asking a question first answers a refusal in
 * the question's own line, and its done act here, in the act's own note where it has one. A done line speaks of the
 * inputs it was pressed on: it goes once one of `inputs` changes, as the editor's bar trades its „Gespeichert“ for the
 * next edit, and once the page is left. Inside an editor whose draft holds unsaved changes every act is closed as a
 * locked one is (`useLocked`).
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
  // One answer for every act, cleared as Next hides the page: a plain act runs here; a question's act runs inside its
  // question, which shows its refusal, and hands its done answer over to stand in the line.
  const { answer, submit, isPending } = useFormAction((press: Press) => press(), { resetOnLeave: true });
  // The inputs of the last press, whose answer the line shows only while they still hold, and the act pressed.
  const [pressed, setPressed] = useState({ on: inputs, at: 0 });
  const status = sameInputs(inputs, pressed.on) ? statusOf(answer, false, isPending) : null;

  return (
    <>
      {children}
      <FormFooter
        place="section"
        status={status}>
        {acts.map((act, at) => (
          <ActButton
            key={at}
            act={act}
            isBusy={isPending && pressed.at === at}
            onPress={() => {
              setPressed({ on: inputs, at });
              // An act at once never calls this: its button runs it alone.
              if (act.run !== undefined && act.confirm === undefined) submit(act.run);
            }}
            onAnswered={(ran) => submit(() => Promise.resolve(ran))}
          />
        ))}
      </FormFooter>
    </>
  );
}
