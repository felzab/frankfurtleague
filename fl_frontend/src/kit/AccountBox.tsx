"use client";

import { startTransition, useRef, useState } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { cardSurface, stacked } from "./cardStyles";
import { ConfirmDialog } from "./ConfirmDialog";
import { CutText } from "./CutText";
import { Dialog } from "./Dialog";
import { useLocked } from "./draftUnsaved";
import { FieldStack } from "./FieldStack";
import { FormFooter } from "./FormFooter";
import { HeldForm } from "./HeldForm";
import { boxHead, dangerEdge, SectionTitle } from "./Section";
import { appToast } from "./Toast";
import { tv } from "./tv";
import { statusOf, useFormAction } from "./useFormAction";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy, RecordText, Verb, Words } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";
import type { TouchVerb } from "./dialogAct";
import type { FormStatus } from "./useFormAction";

/**
 * What a box's act does: a server action, or the browser's own act such as a passkey's set-up, the box's fields
 * posted by their `name`s.
 */
type Run = (formData: FormData) => Promise<ActionAnswer<unknown>>;

/** The question an act asks before it runs; its button then carries the question's verb and record. */
type Question = ConfirmWords;

/** The one act a box's footer holds, beside its status line. */
export type AccountAct = {
  run: Run;
  /**
   * What the act posts beside the box's fields, unseen: the address the page was drawn for, `holder`, which its touch
   * answers for too. A field rather than a closure around `run`, so a box drawn on the server hands its act a server
   * action's reference alone.
   */
  carry?: Readonly<Record<string, string>>;
  /** The toast once it is done, for an act that leaves nothing in the box to change. */
  done?: Copy;
  /** Why the act cannot run on the box's present state, the button saying why (`Button`). */
  locked?: Copy;
  /** The act saves the box's fields, which the line then says beside its button, „Gespeichert“. */
  saves?: true;
} & (
  | {
      button: { label: Copy };
      /** The button's press asks the passkey touch ahead of `run`, for a person holding a passkey (`usePasskeyTouch`). */
      touch?: boolean;
    }
  | {
      /**
       * The question it asks first, which answers a refusal in its own line as every question does. It takes no touch:
       * no act on the touch's list stands behind a box's question.
       */
      button: { confirm: Question };
      touch?: never;
    }
);

/**
 * The line an act shows: a refusal; a save's „Gespeichert“, or what else it moved; any other done act's note where it
 * moved more than its box shows, and nothing else, since the box's own content says what changed.
 */
function lineOf(answer: ActionAnswer<unknown> | null, isBlocked: boolean, isPending: boolean, saves: boolean): FormStatus {
  if (answer?.ok === true && !saves) return answer.note === undefined || isPending ? null : { tone: "saved", text: answer.note };
  return statusOf(answer, isBlocked, isPending);
}

/** An act through the kit's one form wrapper, behind the passkey touch where it asks one, its outcome as a line. */
function useAct({ run, touch = false, done, saves, carry }: Pick<AccountAct, "run" | "touch" | "done" | "saves" | "carry">) {
  const touched = usePasskeyTouch(touch, carry?.holder);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    touched(async (formData: FormData) => {
      const answered = await run(formData);
      if (answered.ok && done !== undefined) appToast("success", done);
      return answered;
    }),
    { resetOnLeave: true },
  );

  return { send: submit, block, status: lineOf(answer, isBlocked, isPending, saves === true), answer, isBusy: isPending };
}

const box = tv({
  slots: {
    root: cardSurface({ class: "overflow-hidden" }),
    // The title and the sentence under it, in an inline box's row or a stacked box's head (`boxHead`).
    words: "grid gap-1",
    description: "text-sm text-fg-muted",
    // The one box without a footer: its words at the start and its control at the end, in one row that wraps on a
    // phone too narrow for both.
    inline: "flex flex-wrap items-center justify-between gap-4 p-4",
  },
});

/**
 * One box of a Konto page, every box the same shape: its 16-px title and one sentence under it saying what the box
 * holds, over a hairline across the box where content follows, as an editor's section heads its fields (`boxHead`),
 * its content, and a footer band holding the status line and its one act: the primary button for a save,
 * the outlined danger button for an act whose question is a danger's (`askingLook`), its box then taking the danger edge and title an editor's
 * danger box takes, the secondary button for every other. A box holding
 * one control that acts at once, Darstellung's, is the one exception: its title and sentence at the start and its
 * control at the end of one row, no footer; and a box holding nothing this page acts on, an address change an
 * administrator started, which the old address's stop link ends, shows its content and no footer. The outcome stands
 * in the footer's line: a refusal in red with the input kept, a field's message under its field; a done act leaves the
 * line empty, the box showing what changed, and the line's answer is cleared once the page is left. An act asking a
 * question first answers a refusal in the question, which stays open with it, as every question does.
 */
export function AccountBox(
  props: { title: Words; description: Copy } & (
    { act: AccountAct | undefined; children?: ReactNode; control?: never } | { control: ReactElement; act?: never; children?: never }
  ),
) {
  const slots = box();
  // A box whose one act asks a danger's question, Anmeldung's deletion, is a danger box, as an editor's is.
  const danger = props.act !== undefined && "confirm" in props.act.button && props.act.button.confirm.tone === "danger";
  const words = (
    <>
      <SectionTitle
        text={props.title}
        {...(danger ? { tone: "danger" } : {})}
      />
      <p className={slots.description()}>{props.description}</p>
    </>
  );

  if (props.control !== undefined) {
    return (
      <section className={slots.root()}>
        <div className={slots.inline()}>
          <div className={slots.words()}>{words}</div>
          {props.control}
        </div>
      </section>
    );
  }
  if (props.act === undefined) {
    const held = boxHead({ ruled: props.children !== undefined });
    return (
      <section className={slots.root()}>
        <div className={held.head()}>{words}</div>
        {props.children !== undefined && (
          <div className={held.content()}>
            <FieldStack>{props.children}</FieldStack>
          </div>
        )}
      </section>
    );
  }
  return (
    <ActBox
      act={props.act}
      words={words}
      danger={danger}>
      {props.children}
    </ActBox>
  );
}

function ActBox({ act, words, danger, children }: { act: AccountAct; words: ReactElement; danger: boolean; children?: ReactNode }) {
  const slots = box();
  // The footer's own hairline parts a box with nothing under its head from the footer.
  const held = boxHead({ ruled: children !== undefined });
  const { send, block, status, answer, isBusy } = useAct(act);
  // What a done question moved beyond the box, the question having closed with its own line.
  const [questionNote, setQuestionNote] = useState<FormStatus>(null);
  const form = useRef<HTMLFormElement>(null);
  const locked = useLocked(act.locked);

  const carried = (formData: FormData) => {
    for (const [name, value] of Object.entries(act.carry ?? {})) formData.set(name, value);
    return formData;
  };

  // A question's act runs inside the question, which shows its refusal and words a throw; the line says what a done one
  // moved beyond the box, as `lineOf` words a done act.
  const confirmed = async () => {
    setQuestionNote(null);
    const answered = await act.run(carried(new FormData(form.current ?? undefined)));
    if (answered.ok && act.done !== undefined) appToast("success", act.done);
    const { note } = answered.ok ? answered : { note: undefined };
    // An update after the `await` lands outside the press's transition unless it opens one of its own.
    if (note !== undefined) startTransition(() => setQuestionNote({ tone: "saved", text: note }));
    return answered;
  };

  const question = "confirm" in act.button ? act.button.confirm : undefined;
  const label = "label" in act.button ? act.button.label : COPY.shared.withObject(act.button.confirm.subject, act.button.confirm.verb);
  const button = (
    <Button
      // A locked act asking a question keeps the look its question's trigger takes (`Trigger`).
      variant={question === undefined ? (act.saves === true ? "primary" : "secondary") : askingLook(question.tone)}
      type={question === undefined ? "submit" : "button"}
      label={label}
      isBusy={isBusy}
      locked={locked}
    />
  );

  return (
    <section className={slots.root(danger ? { class: dangerEdge() } : {})}>
      <HeldForm
        ref={form}
        validationErrors={answer !== null && !answer.ok ? answer.fieldErrors : undefined}
        onInvalid={block}
        onSend={(formData) => {
          // A locked act's button is a plain one, but Enter in a lone field submits a form with no submit button.
          if (isBusy || locked !== undefined) return;
          setQuestionNote(null);
          send(carried(formData));
        }}>
        <div className={held.head()}>{words}</div>
        {children !== undefined && (
          <div className={held.content()}>
            <FieldStack>{children}</FieldStack>
          </div>
        )}
        <FormFooter
          place="strip"
          status={questionNote ?? status}>
          {question === undefined || locked !== undefined ? (
            button
          ) : (
            <ConfirmDialog
              {...question}
              onConfirm={confirmed}
              trigger={{ label, isBusy }}
            />
          )}
        </FormFooter>
      </HeldForm>
    </section>
  );
}

/** A sentence about a record of the box, in the two parts around the record's own words, which it sets semibold. */
export function AccountSentence({ parts, record }: { parts: { before: Copy; after: Copy }; record: RecordText }) {
  return (
    <p className="text-sm text-fg">
      {parts.before} <strong className="font-semibold break-all">{record.record}</strong> {parts.after}
    </p>
  );
}

/** A row's rename: the dialog asking the one field under the act's title, the field's name its `name`. */
type Rename = { title: Copy; run: (formData: FormData) => Promise<ActionAnswer>; field: ReactElement };

/**
 * A row's removal: the question, then, from its button, the passkey touch and the act. `locked` keeps the button shut
 * where the page knows at render that the act would be refused, the button saying why (`Button`).
 */
type Remove = {
  subject: Copy;
  consequence: Copy;
  locked?: Copy;
  run: () => Promise<ActionAnswer<unknown>>;
} & (
  | { verb: Verb; touch?: never }
  | {
      /** A verb the touched act's toast words as done. */
      verb: TouchVerb;
      /** The address the page was drawn for, the one account the touch may answer for. */
      touch: { holder: string };
    }
);

/** One record of a box: its name, the line under it, and its acts as icon buttons at the row's end. */
export type AccountRow = { id: string; name: RecordText; detail: Copy; rename?: Rename; remove: Remove };

const rowLook = tv({
  slots: {
    list: "grid w-full",
    row: `flex min-h-14 items-center gap-3 ${stacked()} py-2 lg:min-h-13`,
    words: "grid min-w-0 flex-1 text-sm",
    name: "truncate font-semibold",
    // The grey line wraps, as every row's grey line does: cut, it would hide a passkey's last use on a phone.
    detail: "text-xs text-pretty text-fg-muted",
  },
});

/**
 * A box's records as rows, each with its own acts, whose outcome stands in the act's own dialog, or, for an act behind
 * the passkey touch, in its toast.
 */
export function AccountRows({ rows: records }: { rows: ReadonlyArray<AccountRow> }) {
  const slots = rowLook();
  return (
    <div className={slots.list()}>
      {records.map((record) => (
        <Row
          key={record.id}
          record={record}
        />
      ))}
    </div>
  );
}

/** One row: its name over its line, and its icon buttons. */
function Row({ record }: { record: AccountRow }) {
  const slots = rowLook();
  return (
    <div
      data-kit-row
      className={slots.row()}>
      <div className={slots.words()}>
        <CutText
          text={record.name.record}
          className={slots.name()}
        />
        <span className={slots.detail()}>{record.detail}</span>
      </div>
      {record.rename !== undefined && <RenameAct rename={record.rename} />}
      <RemoveAct remove={record.remove} />
    </div>
  );
}

function RenameAct({ rename }: { rename: Rename }) {
  return (
    <Dialog
      title={rename.title}
      act={{ verb: "rename" }}
      action={rename.run}
      trigger={{ icon: "rename", label: COPY.shared.verb.rename }}>
      {rename.field}
    </Dialog>
  );
}

function RemoveAct({ remove }: { remove: Remove }) {
  const face = { icon: "erasures", label: COPY.shared.verb[remove.verb] } as const;
  if (remove.locked !== undefined)
    return (
      <Button
        {...face}
        locked={remove.locked}
      />
    );
  return (
    <ConfirmDialog
      {...(remove.touch === undefined ? { verb: remove.verb } : { verb: remove.verb, touch: remove.touch })}
      subject={remove.subject}
      consequence={remove.consequence}
      tone="danger"
      onConfirm={remove.run}
      trigger={face}
    />
  );
}
