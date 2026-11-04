"use client";

import { createContext, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Form } from "react-aria-components/Form";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { cardSurface, stacked } from "./cardStyles";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { StatusLine } from "./FieldParts";
import { SectionTitle } from "./Section";
import { appToast } from "./Toast";
import { tv } from "./tv";
import { answering, statusOf, useFormAction } from "./useFormAction";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy, RecordText, Verb } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { ConfirmDialogProps } from "./ConfirmDialog";
import type { FormStatus } from "./useFormAction";

/**
 * What a box's act does: a server action, or the browser's own act such as a passkey's set-up, the box's fields
 * posted by their `name`s.
 */
type Run = (formData: FormData) => Promise<ActionAnswer<unknown>>;

/** The question an act asks before it runs; its button then carries the question's verb and record. */
type Question = Omit<ConfirmDialogProps, "trigger" | "onConfirm">;

/** The one act a box's footer holds, beside its status line. */
export type AccountAct = {
  run: Run;
  /** Its button's label, or the question it asks first. */
  button: { label: Copy } | { confirm: Question };
  /** The passkey touch first, for a person holding a passkey (`usePasskeyTouch`). */
  touch?: boolean;
  /** The toast once it is done, for an act that leaves nothing in the box to change. */
  done?: Copy;
  /** Why the act cannot run on the box's present state: the button closed, the line saying it. */
  closed?: Copy;
  /** The act saves the box's fields, which the line then says beside its button, „Gespeichert“. */
  saves?: true;
};

/** Where a row of the box answers into the box's one status line. */
const BoxLine = createContext<((status: FormStatus) => void) | null>(null);

/**
 * The line an act shows: a refusal; a save's „Gespeichert“, or what else it moved; any other done act's note where it
 * moved more than its box shows, and nothing else, since the box's own content says what changed.
 */
function lineOf(answer: ActionAnswer<unknown> | null, isBlocked: boolean, isPending: boolean, saves: boolean): FormStatus {
  if (answer?.ok === true && !saves) return answer.note === undefined || isPending ? null : { tone: "saved", text: answer.note };
  return statusOf(answer, isBlocked, isPending);
}

/** An act through the kit's one form wrapper, the passkey touch first where it asks one, its outcome as a line. */
function useAct({ run, touch = false, done, saves }: Pick<AccountAct, "run" | "touch" | "done" | "saves">) {
  const { touch: askTouch, isTouching } = usePasskeyTouch(touch);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    async (formData: FormData) => {
      const answered = await run(formData);
      if (answered.ok && done !== undefined) appToast("success", done);
      return answered;
    },
    { resetOnLeave: true },
  );
  // The touch's own refusal: the act never ran, so no answer of its says it.
  const [untouched, setUntouched] = useState<Copy | null>(null);

  const send = async (formData: FormData) => {
    setUntouched(null);
    const refusal = await askTouch();
    if (refusal !== null) {
      setUntouched(refusal);
      return;
    }
    submit(formData);
  };

  const status: FormStatus = untouched !== null ? { tone: "error", text: untouched } : lineOf(answer, isBlocked, isPending, saves === true);
  return { send, block, status, answer, isBusy: isPending || isTouching };
}

const box = tv({
  slots: {
    root: cardSurface({ class: "overflow-hidden" }),
    body: "grid gap-4 p-4",
    head: "grid gap-1",
    description: "text-sm text-fg-muted",
    content: "grid justify-items-start gap-4",
    foot: "flex items-center gap-3 border-t border-border bg-bg-card-head px-4 py-3",
    // The one box without a footer: its words at the start and its control at the end, in one row that wraps on a
    // phone too narrow for both.
    inline: "flex flex-wrap items-center justify-between gap-4 p-4",
  },
});

/**
 * One box of a Konto page, every box the same shape: its 16-px title, one sentence under it saying what the box
 * holds, its content, and a footer band holding the status line and its one act, the secondary button but for an
 * act whose question is a danger's. A box holding one control that acts at once, Darstellung's, is the one
 * exception: its title and sentence at the start and its control at the end of one row, no footer; and a box holding
 * nothing this page acts on, an address change an administrator started, which the old address's stop link ends,
 * shows its content and no footer. A row of the
 * box (`AccountRows`) answers on the footer's line too. The outcome stands in that line: a refusal in red with the
 * input kept, a field's message under its field; a done act leaves the line empty, the box showing what changed,
 * and the line's answer is cleared once the page is left.
 */
export function AccountBox(
  props: { title: Copy; description: Copy } & (
    { act: AccountAct | undefined; children?: ReactNode; control?: never } | { control: ReactElement; act?: never; children?: never }
  ),
) {
  const slots = box();
  const head = (
    <div className={slots.head()}>
      <SectionTitle text={props.title} />
      <p className={slots.description()}>{props.description}</p>
    </div>
  );

  if (props.control !== undefined) {
    return (
      <section className={slots.root()}>
        <div className={slots.inline()}>
          {head}
          {props.control}
        </div>
      </section>
    );
  }
  if (props.act === undefined) {
    return (
      <section className={slots.root()}>
        <div className={slots.body()}>
          {head}
          {props.children !== undefined && <div className={slots.content()}>{props.children}</div>}
        </div>
      </section>
    );
  }
  return (
    <ActBox
      act={props.act}
      head={head}>
      {props.children}
    </ActBox>
  );
}

function ActBox({ act, head, children }: { act: AccountAct; head: ReactElement; children?: ReactNode }) {
  const slots = box();
  const { send, block, status, answer, isBusy } = useAct(act);
  // A row's outcome, until the footer's act answers or another row does.
  const [rowStatus, setRowStatus] = useState<FormStatus>(null);
  const form = useRef<HTMLFormElement>(null);
  const shown = rowStatus ?? (act.closed === undefined ? status : { tone: "error", text: act.closed });
  const isClosed = act.closed !== undefined;

  const press = () => {
    setRowStatus(null);
    if (form.current !== null) void send(new FormData(form.current));
  };

  return (
    <section className={slots.root()}>
      <Form
        ref={form}
        validationErrors={answer !== null && !answer.ok ? answer.fieldErrors : undefined}
        onInvalid={block}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isBusy) press();
        }}>
        <div className={slots.body()}>
          {head}
          {children !== undefined && (
            <BoxLine value={setRowStatus}>
              <div className={slots.content()}>{children}</div>
            </BoxLine>
          )}
        </div>
        <div className={slots.foot()}>
          <StatusLine
            status={shown}
            placement="row"
          />
          {"label" in act.button ? (
            <Button
              variant="secondary"
              type="submit"
              label={act.button.label}
              isBusy={isBusy}
              isDisabled={isClosed}
            />
          ) : (
            <ConfirmDialog
              {...act.button.confirm}
              onConfirm={press}
              trigger={
                <Button
                  variant={act.button.confirm.tone === "danger" ? "danger" : "secondary"}
                  label={COPY.shared.withObject(act.button.confirm.subject, act.button.confirm.verb)}
                  isBusy={isBusy}
                  isDisabled={isClosed}
                />
              }
            />
          )}
        </div>
      </Form>
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

/** A row's removal: the question first, then the passkey touch where the person holds one, then the act. */
type Remove = { verb: Verb; subject: Copy; consequence: Copy; touch: boolean; run: () => Promise<ActionAnswer<unknown>> };

/** One record of a box: its name, the line under it, and its acts as icon buttons at the row's end. */
export type AccountRow = { id: string; name: RecordText; detail: Copy; rename?: Rename; remove: Remove };

const rows = tv({
  slots: {
    list: "grid w-full",
    row: `flex min-h-14 items-center gap-3 ${stacked()} py-2 lg:min-h-13`,
    words: "grid min-w-0 flex-1 text-sm",
    name: "truncate font-semibold",
    detail: "truncate text-xs text-fg-muted",
  },
});

/** A box's records as rows, each with its own acts, whose outcome stands on the box's status line. */
export function AccountRows({ rows: records }: { rows: ReadonlyArray<AccountRow> }) {
  const slots = rows();
  return (
    <div className={slots.list()}>
      {records.map((record) => (
        <div
          key={record.id}
          className={slots.row()}>
          <div className={slots.words()}>
            <span
              className={slots.name()}
              title={record.name.record}>
              {record.name.record}
            </span>
            <span className={slots.detail()}>{record.detail}</span>
          </div>
          {record.rename !== undefined && <RenameAct rename={record.rename} />}
          <RemoveAct remove={record.remove} />
        </div>
      ))}
    </div>
  );
}

function RenameAct({ rename }: { rename: Rename }) {
  return (
    <Dialog
      title={rename.title}
      act={{ verb: "rename" }}
      action={rename.run}
      trigger={
        <Button
          icon="rename"
          label={COPY.shared.verb.rename}
        />
      }>
      {rename.field}
    </Dialog>
  );
}

function RemoveAct({ remove }: { remove: Remove }) {
  const setLine = useContext(BoxLine);
  const router = useRouter();
  const { touch: askTouch } = usePasskeyTouch(remove.touch);
  const [isBusy, setBusy] = useState(false);

  const confirm = async () => {
    setLine?.(null);
    setBusy(true);
    try {
      const refusal = await askTouch();
      if (refusal !== null) {
        setLine?.({ tone: "error", text: refusal });
        return;
      }
      // Through the form wrapper's own answering, so a throw reads the page again as every act's does.
      const answered = await answering(remove.run, router.refresh)(undefined);
      if (!answered.ok) setLine?.({ tone: "error", text: answered.reason ?? COPY.shared.failure.unexpected });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      verb={remove.verb}
      subject={remove.subject}
      consequence={remove.consequence}
      tone="danger"
      onConfirm={confirm}
      trigger={
        <Button
          icon="erasures"
          label={COPY.shared.verb[remove.verb]}
          isBusy={isBusy}
        />
      }
    />
  );
}
