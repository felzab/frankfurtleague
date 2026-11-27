"use client";

import { Fragment, useRef } from "react";

import { COPY } from "@/core/copy/shared";

import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { DraftUnsaved, useLocked } from "./draftUnsaved";
import { EditorBar } from "./EditorBar";
import { dangerConsequence } from "./fieldStyles";
import { FormClosed } from "./formClosed";
import { HeldForm } from "./HeldForm";
import { formColumn, RailPage } from "./RailFrame";
import { dangerRow, editorHead, lockSlot, Section } from "./Section";

import type { Copy, LockReason } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { ConfirmQuestion } from "./ConfirmDialog";
import type { DialogAct } from "./dialogAct";
import type { PageTitle } from "./RailFrame";
import type { Editor, EditorValue } from "./useEditor";

/**
 * One of an editor's sections, in the order the person's task takes them: its title, its ⓘ and its fields. A sentence
 * under a field is cut at the field's width, and a short field is narrower than one.
 */
export type EditorSection = {
  id: string;
  title: Copy;
  help?: readonly [Copy, ...Copy[]];
  fields: ReactElement;
};

/**
 * A part of an editor that draws its own boxes, such as a line-up's two lists (`Lineup`): placed bare in the sections'
 * column, where a section's box around it would stand as a box in a box. It says its own state on its own lines; a
 * closed editor's reason stands in the lock line under the title, as every editor's does.
 */
type EditorBlock = { id: string; block: ReactElement };

export type EditorPart = EditorSection | EditorBlock;

/**
 * An irreversible or retiring act, which stands as one row in an editor's danger box, its button asking before it
 * acts: a question, or a dialog where the act takes inputs first, such as an exit's route, reason and day.
 */
export type DangerAct = {
  name: Copy;
  consequence: Copy;
  /** Why the act cannot run on the record as it stands, which the page read, the button saying why. */
  locked?: Copy;
} & (
  | {
      /**
       * The question its button opens; the button carries the question's verb and tone. An act behind the passkey touch
       * asks it from the question's own button: an editor is an administrator's page, and an administrator signs in by
       * passkey alone, so the person always holds one.
       */
      confirm: ConfirmQuestion;
      dialog?: never;
    }
  | {
      /** The dialog its button opens; the button carries the dialog's act and its tone. */
      dialog: DialogAct & { tone: "danger" };
      confirm?: never;
    }
);

function DangerRow({ act }: { act: DangerAct }) {
  const locked = useLocked(act.locked);
  let button: ReactElement;
  // Its button says the verb alone, „Löschen“, so the row's name says what it acts on, as a list row's does.
  if (act.dialog === undefined) {
    const { onConfirm, touch, ...question } = act.confirm;
    button = (
      <ConfirmDialog
        question={question}
        onConfirm={onConfirm}
        touch={touch}
        trigger={{ label: COPY.shared.verb[question.verb], locked }}
      />
    );
  } else
    button = (
      <Dialog
        {...act.dialog}
        trigger={{ label: actLabel(act.dialog.act), locked }}
      />
    );
  return (
    <div className={dangerRow()}>
      <div className="grid min-w-0 flex-1 text-sm">
        <span className="font-semibold">{act.name}</span>
        <p className={dangerConsequence()}>{act.consequence}</p>
      </div>
      {button}
    </div>
  );
}

/**
 * The editor template: its sections one under another in the form column, and the record's one save in `EditorBar` at
 * the foot of the viewport. There is no „Abbrechen“: the
 * way out is the frame's „‹ Zurück“ to the record's list, which the frame's band places at the address of every
 * route the route table marks `editor` (`RailColumn`) and which asks before it drops unsaved changes. The danger box comes last, a box of its own
 * under its own title holding the danger rows, the one place an editor's irreversible and retiring acts stand,
 * apart from the fields the bar saves as GitHub's danger zone stands apart from a repository's settings; an
 * editor with none of its acts open draws no such box. The fields are the kit's, bound to `editor`'s draft by
 * the page's own client code, which the page renders once it has read the record.
 *
 * A lock is a state, said once: one muted line under the title, after the Vorschau, names why fields stand locked,
 * each reason once (`COPY.template.lockLine`), and each locked field shows the lock at its label (`isLocked`), so the
 * line names no field and no box carries a note for it. The line's place stands in every editor, empty where nothing
 * is locked, at one line's height in every state (`lockSlot`), so nothing under the title moves as a lock comes or goes.
 * The warn hue is left to what a change being made will cause. A record its season no longer lets change opens
 * `closed`, read-only rather than open to a save the write refuses: every field read-only, its reason in the lock line,
 * no field's consequence, since nothing is changed there, and neither the danger box nor the bar, since there is
 * nothing to save. The chip after the title
 * is the record's own state, as its list and its card show it, a phase that locks the record included, such as a
 * line-up's „Gesperrt“, and the lock line says why. A danger box
 * whose acts are about more than the closed record stays (`outlivesClosed`), as a club is retired from the league and
 * not from a finished season.
 */
export function EditorPage<Values extends Record<string, EditorValue>>({
  title,
  chip,
  flag,
  lead,
  link,
  editor,
  barText,
  sections,
  danger,
  locks = [],
  closed,
}: {
  title: PageTitle;
  chip?: ChipProps;
  /** What that status leaves unsaid, after it. */
  flag?: ChipProps;
  /**
   * The Vorschau: one line under the title saying a fact about the record as it is stored, such as a match's pairing,
   * its day and its result or that none is stored yet. Never the unsaved changes, which the bar's status line counts.
   */
  lead?: Copy;
  /** The way to the record's public page in the strip, such as a match's own page, once the record has one. */
  link?: { href: Route; label: Copy };
  /**
   * Why some of its fields stand locked while the record is open, each reason once, which the lock line says; each
   * field it holds is `isLocked`, off the same fact.
   */
  locks?: readonly LockReason[];
  /**
   * The reason the record is closed read-only, such as its season having finished, which stands as the lock line;
   * absent while it is open.
   */
  closed?: Copy;
  editor: Editor<Values>;
  /** The page's own words on the bar's status line, before its count of unsaved changes. */
  barText?: Copy;
  sections: readonly [EditorPart, ...EditorPart[]];
  /** The danger box: its title, naming what its acts are about, and its rows. */
  danger?: { title: Copy; acts: ReadonlyArray<DangerAct>; outlivesClosed?: true };
}) {
  const form = useRef<HTMLFormElement>(null);
  // A closed record's one reason covers every field, so it stands alone.
  const lock = closed ?? (locks.length === 0 ? undefined : COPY.template.lockLine(locks));

  return (
    <RailPage
      scope="area"
      title={title}
      chip={chip}
      flag={flag}
      link={link}
      bar={
        closed === undefined ? (
          <EditorBar
            status={editor.status}
            text={barText}
            isPending={editor.isPending}
            question={{ asked: editor.question, confirm: editor.confirm, decline: editor.decline }}
            onSave={() => form.current?.requestSubmit()}
          />
        ) : undefined
      }>
      <HeldForm
        ref={form}
        validationErrors={editor.fieldErrors}
        // The browser judges each field's own rules first; a field it keeps back points the status line at it.
        onInvalid={() => editor.block()}
        // A second save mid-flight would go on the version the first stores past, its refusal standing over a save that
        // went through.
        isBusy={editor.isPending}
        onSend={() => editor.submit()}
        className={formColumn()}>
        {/* The lines under the title, the Vorschau and the lock, one step apart as a box's title and its line are. */}
        <div className={editorHead()}>
          {lead !== undefined && <p>{lead}</p>}
          <p className={lockSlot()}>{lock}</p>
        </div>
        <FormClosed value={closed !== undefined}>
          <DraftUnsaved value={editor.count > 0 ? COPY.template.draftUnsaved : undefined}>
            {sections.map((section) =>
              "block" in section ? (
                <Fragment key={section.id}>{section.block}</Fragment>
              ) : (
                <Section
                  key={section.id}
                  title={section.title}
                  help={section.help}>
                  {section.fields}
                </Section>
              ),
            )}
            {(closed === undefined || danger?.outlivesClosed === true) && danger !== undefined && danger.acts.length > 0 && (
              <Section
                title={danger.title}
                danger={danger.acts.map((act) => (
                  <DangerRow
                    key={act.name}
                    act={act}
                  />
                ))}
              />
            )}
          </DraftUnsaved>
        </FormClosed>
      </HeldForm>
    </RailPage>
  );
}
