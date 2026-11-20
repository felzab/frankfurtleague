"use client";

import { useRef } from "react";

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
import { toastAnswer } from "./Toast";
import { tv } from "./tv";
import { statusOf, useFormAction } from "./useFormAction";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy, RecordText, Words } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { ConfirmWords } from "./ConfirmDialog";
import type { DoneVerb } from "./dialogAct";

/**
 * What a box's act does: a server action, or the browser's own act such as a passkey's set-up, the box's fields
 * posted by their `name`s.
 */
type Run = (formData: FormData) => Promise<ActionAnswer<unknown>>;

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
  /**
   * The toast's title once it is done, where its answer brings no note: none for an act whose box shows what it
   * changed, such as a passkey set up, which then raises a toast only for a note.
   */
  done?: Copy;
  /** Why the act cannot run on the box's present state, the button saying why. */
  locked?: Copy;
} & (
  | {
      /** `variant` is `primary` for the box's save of its own fields, its main act. */
      button: { label: Copy; variant?: "primary" | "secondary" };
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
 * The act on the box's fields and what it carries, a done one saying itself in a toast: the note its answer brings, or
 * the act's `done`, and nothing where neither stands, the box's own content saying what changed.
 */
function runOf({ run, carry, done }: Pick<AccountAct, "run" | "carry" | "done">): Run {
  return async (formData) => {
    for (const [name, value] of Object.entries(carry ?? {})) formData.set(name, value);
    const answered = await run(formData);
    const title = answered.ok ? (answered.note ?? done) : undefined;
    if (title !== undefined) toastAnswer(answered, title);
    return answered;
  };
}

/** The box's own press, its line a refusal's alone: a done act says itself in its toast, if anywhere. */
function useAct(act: AccountAct) {
  const touched = usePasskeyTouch(act.touch === true, act.carry?.holder);
  const run = runOf(act);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(touched(run), { resetOnLeave: true });
  const status = answer?.ok === true ? null : statusOf(answer, isBlocked, isPending);
  return { run, send: submit, block, status, answer, isBusy: isPending };
}

const box = tv({
  slots: {
    root: cardSurface({ class: "overflow-hidden" }),
    words: "grid gap-1",
    description: "text-sm text-fg-muted",
    inline: "flex flex-wrap items-center justify-between gap-4 p-4",
  },
});

/**
 * One box of a Konto page: its title and one sentence saying what the box holds, its content, and a footer holding the
 * status line and its one act. A box whose act asks a danger's question takes the danger edge and title an editor's
 * danger box takes. A box holding one control that acts at once, Darstellung's, has no footer; nor has a box holding
 * nothing this page acts on, an address change an administrator started, which the old address's stop link ends. A
 * refusal stands in the footer's line with the input kept, a field's message under its field, and is cleared once the
 * page is left; a done act leaves the line empty and says itself in a toast where its answer notes more than the box
 * shows or the act names its word (`done`), the line taking no row a phone's page would move by. An act asking a
 * question first answers a refusal in the question, which stays open with it, as every question does.
 */
export function AccountBox(
  props: { title: Words; description: Copy } & (
    { act: AccountAct | undefined; children?: ReactNode; control?: never } | { control: ReactElement; act?: never; children?: never }
  ),
) {
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
  const { run, send, block, status, answer, isBusy } = useAct(act);
  const form = useRef<HTMLFormElement>(null);
  const locked = useLocked(act.locked);

  // A question's act runs inside the question, which shows its refusal and words a throw; done, it says itself in the
  // box's toast, as the box's own press does.
  const confirmed = () => run(new FormData(form.current ?? undefined));

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
              doneShown
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
    list: "grid w-full",
    row: `flex ${rowHeight()} items-center gap-3 ${stacked()} py-2`,
    words: "grid min-w-0 flex-1 text-sm",
    name: "truncate font-semibold",
    // The grey line wraps, as every row's grey line does: cut, it would hide the end of a row's detail on a phone.
    detail: "text-xs text-pretty text-fg-muted",
  },
});

/**
 * A box's records as rows, each with its own acts: a done act says itself in a toast, and a refusal stands in the act's
 * own dialog, or, for an act behind the passkey touch, in its toast too.
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
      run={rename.run}
      trigger={{ icon: "rename", label: COPY.shared.verb.rename }}>
      {rename.field}
    </Dialog>
  );
}

function RemoveAct({ remove }: { remove: Remove }) {
  const face = { icon: "erasures", label: COPY.shared.verb[remove.verb], locked: remove.locked } as const;
  return (
    <ConfirmDialog
      question={{ verb: remove.verb, subject: remove.subject, consequence: remove.consequence, tone: "danger" }}
      {...(remove.touch === undefined ? {} : { touch: remove.touch })}
      onConfirm={remove.run}
      trigger={face}
    />
  );
}
