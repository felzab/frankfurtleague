"use client";

import { useRef, useState } from "react";

import { Form } from "react-aria-components/Form";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { EditorBar } from "./EditorBar";
import { FormClosed } from "./formClosed";
import { formColumn, RailPage } from "./RailFrame";
import { Section } from "./Section";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { ConfirmDialogProps } from "./ConfirmDialog";
import type { SaveWarning } from "./EditorBar";
import type { PageTitle } from "./RailFrame";
import type { Editor, EditorValue } from "./useEditor";

/**
 * One of an editor's sections, in the order the person's task takes them: its title, its ⓘ, its fields, and `note`,
 * the sentence under the title saying why some of its fields cannot change, such as a season's start fixed once a
 * match has taken place. A sentence under a field is cut at the field's width, and a short field is narrower than one.
 */
export type EditorSection = { id: string; title: Copy; help?: Copy; note?: Copy; fields: ReactElement };

/**
 * An irreversible or retiring act, which stands as one row in an editor's last box: its name and its
 * consequence at the left, its button at the right, which asks before it acts.
 */
export type DangerAct = {
  name: Copy;
  consequence: Copy;
  /** The question its button opens; the button carries the question's verb and tone. */
  confirm: Omit<ConfirmDialogProps, "trigger" | "open">;
  /**
   * The passkey touch before the question, for an act on its fixed list: whether the person holds a passkey,
   * which the page read, and the address the page was drawn for (`usePasskeyTouch`).
   */
  touch?: { held: boolean; holder: string };
};

/**
 * One danger row. An act behind the passkey touch asks the touch on its press, its button busy until the
 * browser's prompt answers, and only then its question; a touch the passkey did not answer opens nothing, and
 * the row's second line says so in place of the consequence, as a Konto box's line says why its act did not run.
 */
function DangerRow({ act }: { act: DangerAct }) {
  const [isAsking, setAsking] = useState(false);
  const { run, refusal, isTouching } = usePasskeyTouch(act.touch?.held ?? false, act.touch?.holder);
  const label = COPY.shared.verb[act.confirm.verb];
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] px-4 py-2 lg:min-h-13">
      <div className="grid min-w-0 flex-1 text-sm">
        <span className="font-semibold">{act.name}</span>
        {/* A polite status from the first render, so the touch's refusal is announced as it replaces the consequence. */}
        <span
          role="status"
          className={refusal === null ? "text-xs text-fg-muted" : "text-xs text-danger"}>
          {refusal ?? act.consequence}
        </span>
      </div>
      {act.touch === undefined ? (
        <ConfirmDialog
          {...act.confirm}
          trigger={
            <Button
              variant={act.confirm.tone}
              label={label}
            />
          }
        />
      ) : (
        <>
          <Button
            variant={act.confirm.tone}
            label={label}
            isBusy={isTouching}
            onPress={() => void run(() => setAsking(true))}
          />
          <ConfirmDialog
            {...act.confirm}
            open={{ isOpen: isAsking, onOpenChange: setAsking }}
          />
        </>
      )}
    </div>
  );
}

/**
 * The editor template: its sections one under another in the column of at most 760 px centred in the
 * content (`formColumn`, as the read page's), each a box exactly as tall as its content under its 16-px
 * title, and the record's one save in `EditorBar` at the foot of the viewport. There is no „Abbrechen“: the
 * way out is the frame's „‹ Zurück“ to the record's list, which an editor's route group places
 * (`RailColumn`) and which asks before it drops unsaved changes. The last box ends in the danger rows, the
 * one place an editor's irreversible and retiring acts stand. The fields are the kit's, bound to `editor`'s
 * draft by the page's own client code, which the template's server half, `EditorShell`, waits for.
 *
 * A record its season no longer lets change opens `closed`, read-only rather than open to a save the write
 * refuses: every field disabled, the reason under the first box's title, the chip „Abgeschlossen“ after the
 * title, and neither the danger rows nor the bar, since there is nothing to save.
 */
export function EditorPage<Values extends Record<string, EditorValue>>({
  title,
  chip,
  lead,
  editor,
  sections,
  danger,
  warning,
  closed,
}: {
  title: PageTitle;
  chip?: ChipProps;
  /**
   * The Vorschau: one line under the title saying how the record reads, such as a match's pairing, its score and
   * its outcome, or that no result is stored yet.
   */
  lead?: Copy;
  /** The reason the record is closed read-only, such as its season having finished; absent while it is open. */
  closed?: Copy;
  editor: Editor<Values>;
  sections: readonly [EditorSection, ...EditorSection[]];
  danger?: ReadonlyArray<DangerAct>;
  /** The question a save of these changes asks first, only for a consequence beyond the record. */
  warning?: (changes: Partial<Values>) => SaveWarning | null;
}) {
  const form = useRef<HTMLFormElement>(null);
  const last = sections.length - 1;

  return (
    <RailPage
      scope="area"
      title={title}
      chip={closed === undefined ? chip : { tone: "neutral", label: COPY.template.closed }}
      bar={
        closed === undefined ? (
          <EditorBar
            status={editor.status}
            isPending={editor.isPending}
            warning={warning?.(editor.changes) ?? null}
            onSave={() => form.current?.requestSubmit()}
          />
        ) : undefined
      }>
      <Form
        ref={form}
        validationErrors={editor.fieldErrors}
        // The browser judges each field's own rules first; a field it keeps back points the status line at it.
        onInvalid={() => editor.block()}
        onSubmit={(event) => {
          event.preventDefault();
          editor.submit();
        }}
        className={formColumn()}>
        {lead !== undefined && <p className="text-sm text-fg-muted">{lead}</p>}
        <FormClosed value={closed !== undefined}>
          {sections.map((section, index) => (
            <Section
              key={section.id}
              title={section.title}
              help={section.help}
              // A closed record's one reason covers every field, so it stands alone, under the first box's title.
              note={closed === undefined ? section.note : index === 0 ? closed : undefined}
              danger={
                index === last &&
                closed === undefined &&
                danger?.map((act) => (
                  <DangerRow
                    key={act.name}
                    act={act}
                  />
                ))
              }>
              {section.fields}
            </Section>
          ))}
        </FormClosed>
      </Form>
    </RailPage>
  );
}
