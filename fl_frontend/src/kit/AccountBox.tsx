"use client";

import { useRef, useState } from "react";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { cardSurface, rowHeight, stacked } from "./cardStyles";
import { ConfirmDialog } from "./ConfirmDialog";
import { CutText } from "./CutText";
import { Dialog } from "./Dialog";
import { useLocked } from "./draftUnsaved";
import { FieldStack } from "./FieldStack";
import { FormFooter } from "./FormFooter";
import { HeldForm } from "./HeldForm";
import { boxHead, dangerEdge, SectionTitle } from "./Section";
import { SideActs } from "./SideActs";
import { toastAnswer } from "./Toast";
import { tv } from "./tv";
import { statusOf, useFormAction } from "./useFormAction";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer, DryRunAction } from "@/core/action";
import type { Copy, RecordText, Words } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";
import type { DoneVerb } from "./dialogAct";
import type { SideAct } from "./SideActs";

/**
 * What a box's act does: a server action, or the browser's own act such as a passkey's set-up, the box's fields
 * posted by their `name`s, and `dryRun` true for the dry run of an act declaring one.
 */
type Run = (formData: FormData, dryRun?: boolean) => Promise<ActionAnswer<unknown>>;

type Question = ConfirmWords;

/** The one act a box's footer holds, beside its status line. */
export type AccountAct = (
  | { run: Run; dryRun?: never }
  | {
      /**
       * An act whose lane declares its dry run, over fields the server judges: a touched press sends it first, so a
       * refusal stands on its field before the touch (`usePasskeyTouch`).
       */
      run: DryRunAction<FormData, unknown>;
      dryRun: true;
    }
) & {
  /**
   * What the act posts beside the box's fields, unseen: the address the page was drawn for, `holder`, which its touch
   * answers for too. A field rather than a closure around `run`, so a box drawn on the server hands its act a server
   * action's reference alone.
   */
  carry?: Readonly<Record<string, string>>;
  /** The toast's title once it is done, where its answer brings no note. */
  done: Copy;
  /** Why the act cannot run on the box's present state, the button saying why. */
  locked?: Copy;
} & (
    | {
        /** `variant` is `primary` for the box's save of its own fields, its main act. */
        button: { label: Copy; variant?: "primary" | "secondary" };
        /** The button's press asks the passkey touch ahead of `run`, for an administrator (`usePasskeyTouch`). */
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

/** The act on the box's fields and what it carries. */
function carried({ run, carry }: Pick<AccountAct, "run" | "carry">): Run {
  return async (formData, dryRun) => {
    for (const [name, value] of Object.entries(carry ?? {})) formData.set(name, value);
    return dryRun === true ? run(formData, dryRun) : run(formData);
  };
}

/**
 * The act the box's own press runs, a done one saying itself in a toast: the note its answer brings, or the act's
 * `done`. A passing dry run says nothing, as the act has yet to run.
 */
function runOf(act: Pick<AccountAct, "run" | "carry" | "done">): Run {
  const run = carried(act);
  return async (formData, dryRun) => {
    const answered = await run(formData, dryRun);
    // A refusal stands in the box's line.
    if (answered.ok && dryRun !== true) toastAnswer(answered, act.done);
    return answered;
  };
}

/** The box's own press, its line a refusal's alone: a done act says itself in its toast. */
function useAct(act: AccountAct) {
  const touched = usePasskeyTouch(act.touch === true, act.carry?.holder);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    touched(runOf(act), act.dryRun === true ? { dryRunFirst: true } : undefined),
    { resetOnLeave: true },
  );
  const status = statusOf(answer, isBlocked, isPending);
  return { send: submit, block, status, answer, isBusy: isPending };
}

const box = tv({
  slots: {
    root: cardSurface({ class: "overflow-hidden" }),
    description: "text-sm text-fg-muted",
  },
});

/**
 * One box of a Konto page: its title and one sentence saying what the box holds, its content, and a footer holding the
 * status line and its one act. A box whose act asks a danger's question takes the danger edge and title an editor's
 * danger box takes. A box holding nothing this page acts on, an address change an administrator started, which the old
 * address's stop link ends, has no footer. A refusal stands in the footer's line with the input kept, a field's message
 * under its field, and is cleared once the page is left; a done act leaves the line empty and says itself in a toast,
 * its answer's note or the act's word (`done`), the line taking no row a phone's page would move by. An act asking a
 * question first answers a refusal in the question, which stays open with it, as every question does.
 */
export function AccountBox(props: { title: Words; description: Copy; act: AccountAct | undefined; children?: ReactNode }) {
  const slots = box();
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
  const form = useRef<HTMLFormElement>(null);
  const locked = useLocked(act.locked);

  // A question's act runs inside the question, which shows its refusal, words a throw and raises the one toast of a
  // done act: its note, else the box's word.
  const confirmed = () => carried(act)(new FormData(form.current ?? undefined));

  return (
    <section className={slots.root(danger ? { class: dangerEdge() } : {})}>
      <HeldForm
        ref={form}
        validationErrors={answer !== null && !answer.ok ? answer.fieldErrors : undefined}
        onInvalid={block}
        // A locked act's button is a plain one, but Enter in a lone field submits a form with no submit button.
        isBusy={isBusy || locked !== undefined}
        onSend={send}>
        <div className={held.head()}>{words}</div>
        {children !== undefined && (
          <div className={held.content()}>
            <FieldStack>{children}</FieldStack>
          </div>
        )}
        <FormFooter
          place="strip"
          status={status}>
          {"label" in act.button ? (
            <Button
              variant={act.button.variant ?? "secondary"}
              type="submit"
              label={act.button.label}
              isBusy={isBusy}
              locked={locked}
            />
          ) : (
            <ConfirmDialog
              question={act.button.confirm}
              onConfirm={confirmed}
              done={act.done}
              trigger={{ label: COPY.shared.withObject(act.button.confirm.subject, act.button.confirm.verb), isBusy, locked }}
            />
          )}
        </FormFooter>
      </HeldForm>
    </section>
  );
}

/** A box's sentence around a record's own value, such as an address, which it sets semibold. */
export function AccountSentence({ sentence: [before, record, after] }: { sentence: readonly [Copy, RecordText, Copy] }) {
  return (
    <p className="text-sm text-fg">
      {before}
      <strong className="font-semibold break-all">{record.record}</strong>
      {after}
    </p>
  );
}

/** A row's rename: the dialog asking the one field under the act's title, the field's name its `name`. */
type Rename = { title: Copy; run: (formData: FormData) => Promise<ActionAnswer>; field: ReactElement };

/**
 * A row's removal: the question, then, from its button, the passkey touch and the act. `locked` keeps the button shut
 * where the page knows at render that the act would be refused, the button saying why.
 */
type Remove = {
  /** The act's verb, which its toast words as done. */
  verb: DoneVerb;
  subject: Copy;
  consequence: Copy;
  locked?: Copy;
  run: () => Promise<ActionAnswer<unknown>>;
  /** The address the page was drawn for, the one account the touch may answer for. */
  touch?: { holder: string };
};

export type AccountRow = { id: string; name: RecordText; detail: Copy; rename?: Rename; remove: Remove };

const rowLook = tv({
  slots: {
    // The container the rows' side acts read, so every row of the list takes one form.
    list: "@container grid w-full",
    row: `flex ${rowHeight()} items-center gap-3 ${stacked()} py-2`,
    words: "grid min-w-0 flex-1 text-sm",
    // In the medium weight, as every card row's name.
    name: "truncate font-medium",
    // The grey line wraps, as every row's grey line does: cut, it would hide the end of a row's detail on a phone.
    detail: "text-xs text-pretty text-fg-muted",
  },
});

/** A box's records as rows, each with its own acts: a done act says itself in a toast, and a refusal stands in the act's own dialog. */
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

/**
 * One record and its side acts (`SideActs`), the rename before the removal, in the form the list decides: their
 * labelled buttons, the removal's in the outlined danger look, or the row's „⋯“. Each opens its dialog or its question
 * on the open state its press sets, and the removal asks the touch from its question's final press.
 */
function Row({ record }: { record: AccountRow }) {
  const slots = rowLook();
  const { rename, remove } = record;
  const [isRenaming, setRenaming] = useState(false);
  const [isAsking, setAsking] = useState(false);
  const acts: SideAct[] = [
    ...(rename === undefined ? [] : [{ label: COPY.shared.verb.rename, onPress: () => setRenaming(true) }]),
    {
      label: COPY.shared.verb[remove.verb],
      tone: "danger",
      ...(remove.locked === undefined ? {} : { locked: remove.locked }),
      onPress: () => setAsking(true),
    },
  ];
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
      <SideActs acts={acts}>
        {rename !== undefined && (
          <Dialog
            title={rename.title}
            act={{ verb: "rename" }}
            run={rename.run}
            open={{ isOpen: isRenaming, onOpenChange: setRenaming }}>
            {rename.field}
          </Dialog>
        )}
        <ConfirmDialog
          question={{ verb: remove.verb, subject: remove.subject, consequence: remove.consequence, tone: "danger" }}
          {...(remove.touch === undefined ? {} : { touch: remove.touch })}
          onConfirm={remove.run}
          open={{ isOpen: isAsking, onOpenChange: setAsking }}
        />
      </SideActs>
    </div>
  );
}
