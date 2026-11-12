"use client";

import { Fragment, useRef } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { actLabel } from "./dialogAct";
import { DraftUnsaved, useLocked } from "./draftUnsaved";
import { EditorBar } from "./EditorBar";
import { statusLine } from "./fieldStyles";
import { FormClosed } from "./formClosed";
import { HeldForm } from "./HeldForm";
import { formColumn, RailPage } from "./RailFrame";
import { dangerRow, Section } from "./Section";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { ConfirmQuestion } from "./ConfirmDialog";
import type { DialogAct } from "./dialogAct";
import type { PageTitle } from "./RailFrame";
import type { Editor, EditorValue } from "./useEditor";

/**
 * One of an editor's sections, in the order the person's task takes them: its title, its ⓘ, its fields, and `note`,
 * the sentence under the title saying why some of its fields cannot change, such as a season's start fixed once a
 * match has taken place. A sentence under a field is cut at the field's width, and a short field is narrower than one.
 */
export type EditorSection = { id: string; title: Copy; help?: readonly [Copy, ...Copy[]]; note?: Copy; fields: ReactElement };

/**
 * A part of an editor that draws its own boxes, such as a line-up's two lists (`Lineup`): placed bare in the sections'
 * column, where a section's box around it would stand as a box in a box. It says its own state on its own lines; a
 * closed editor's reason stands under the first section's title, or under the lead where no section has one.
 */
type EditorBlock = { id: string; block: ReactElement };

/** One part of an editor's column, in the order the person's task takes them: a titled section or a bare block. */
export type EditorPart = EditorSection | EditorBlock;

/**
 * An irreversible or retiring act, which stands as one row in an editor's danger box: its name and its
 * consequence at the left, its button at the right, which asks before it acts: a question, or a dialog where the act
 * takes inputs first, such as an exit's route, reason and day.
 */
export type DangerAct = {
  name: Copy;
  consequence: Copy;
  /** Why the act cannot run on the record as it stands, which the page read, the button saying why (`Button`). */
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

/** One danger row, whose question or dialog answers for its act, a passkey touch's refusal among what it shows. */
function DangerRow({ act }: { act: DangerAct }) {
  const label = act.dialog === undefined ? COPY.shared.verb[act.confirm.verb] : actLabel(act.dialog.act);
  const locked = useLocked(act.locked);
  return (
    // A flat row across the danger box, parted from the one above by the hairline every stacked part takes.
    <div className={dangerRow()}>
      <div className="grid min-w-0 flex-1 text-sm">
        <span className="font-semibold">{act.name}</span>
        <p className={statusLine({ placement: "column", tone: "resting" })}>{act.consequence}</p>
      </div>
      {/* Its button says the verb alone, „Löschen“, so the row's name says what it acts on, as a list row's does. */}
      {locked !== undefined ? (
        <Button
          variant={askingLook(act.dialog === undefined ? act.confirm.tone : act.dialog.tone)}
          label={label}
          locked={locked}
        />
      ) : act.dialog === undefined ? (
        <ConfirmDialog
          {...act.confirm}
          trigger={{ label }}
        />
      ) : (
        <Dialog
          {...act.dialog}
          trigger={{ label }}
        />
      )}
    </div>
  );
}

/**
 * The editor template: its sections one under another in the column of at most 760 px centred in the
 * content (`formColumn`, as the read page's), each a box exactly as tall as its content under its 16-px
 * title, and the record's one save in `EditorBar` at the foot of the viewport. There is no „Abbrechen“: the
 * way out is the frame's „‹ Zurück“ to the record's list, which an editor's route group places
 * (`RailColumn`) and which asks before it drops unsaved changes. The danger box comes last, a box of its own
 * under its own title holding the danger rows, the one place an editor's irreversible and retiring acts stand,
 * apart from the fields the bar saves as GitHub's danger zone stands apart from a repository's settings; an
 * editor with none of its acts open draws no such box. The fields are the kit's, bound to `editor`'s draft by
 * the page's own client code, which the template's server half, `EditorShell`, waits for.
 *
 * A record its season no longer lets change opens `closed`, read-only rather than open to a save the write
 * refuses: every field disabled, the reason under the first box's title, or under the lead in an editor of blocks
 * alone, the chip „Abgeschlossen“ after the
 * title, and neither the danger box nor the bar, since there is nothing to save. A danger box whose acts are about more
 * than the closed record stays (`outlivesClosed`), as a club is retired from the league and not from a finished season.
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
  closed,
  closedChip = { tone: "neutral", label: COPY.template.closed },
}: {
  title: PageTitle;
  chip?: ChipProps;
  /** What that status leaves unsaid, after it (`RailPage`). */
  flag?: ChipProps;
  /**
   * The Vorschau: one line under the title saying a fact about the record as it is stored, such as a match's pairing,
   * its day and its result or that none is stored yet, or that the website shows a season. Never the unsaved
   * changes, which the bar's status line counts.
   */
  lead?: Copy;
  /** The way to the record's public page in the strip, such as a match's own page, once the record has one (`RailPage`). */
  link?: { href: Route; label: Copy };
  /** The reason the record is closed read-only, such as its season having finished; absent while it is open. */
  closed?: Copy;
  /** The chip of a closed record whose state says more than „Abgeschlossen“. */
  closedChip?: ChipProps;
  editor: Editor<Values>;
  /** The page's own words on the bar's status line, before its count of unsaved changes (`EditorBar`'s `text`). */
  barText?: Copy;
  sections: readonly [EditorPart, ...EditorPart[]];
  /** The danger box: its title, naming what its acts are about, and its rows. */
  danger?: { title: Copy; acts: ReadonlyArray<DangerAct>; outlivesClosed?: true };
}) {
  const form = useRef<HTMLFormElement>(null);
  const titled = sections.find((section) => !("block" in section));

  return (
    <RailPage
      scope="area"
      title={title}
      chip={closed === undefined ? chip : closedChip}
      flag={flag}
      link={link}
      bar={
        closed === undefined ? (
          <EditorBar
            status={editor.status}
            text={barText}
            isPending={editor.isPending}
            // A save the server held back asks its question from the bar, before it goes again.
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
        // The bar's busy button is not the whole guard: Enter in a lone field submits a form with no submit button too,
        // and a second save mid-flight would go on the version the first stores past, its refusal standing over a save
        // that went through.
        onSend={() => {
          if (!editor.isPending) editor.submit();
        }}
        className={formColumn()}>
        {lead !== undefined && <p className="text-sm text-fg-muted">{lead}</p>}
        {/* An editor of blocks alone has no section's title to stand its reason under: it stands over the blocks, in
            the hue a section's note takes. */}
        {closed !== undefined && titled === undefined && <p className="text-sm text-warn">{closed}</p>}
        <FormClosed value={closed !== undefined}>
          <DraftUnsaved value={editor.count > 0 ? COPY.template.draftUnsaved : undefined}>
            {sections.map((section) =>
              "block" in section ? (
                <Fragment key={section.id}>{section.block}</Fragment>
              ) : (
                <Section
                  key={section.id}
                  title={section.title}
                  help={section.help}
                  // A closed record's one reason covers every field, so it stands alone, under the first box's title.
                  note={closed === undefined ? section.note : section === titled ? closed : undefined}>
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
