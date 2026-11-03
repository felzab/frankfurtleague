"use client";

import { useRef } from "react";

import { Form } from "react-aria-components/Form";

import { COPY } from "@/core/copy";

import { EditorBar } from "./EditorBar";
import { FormClosed } from "./formClosed";
import { formColumn, RailPage } from "./RailFrame";
import { Section } from "./Section";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { SaveWarning } from "./EditorBar";
import type { PageTitle } from "./RailFrame";
import type { DangerAct } from "./Section";
import type { Editor, EditorValue } from "./useEditor";

/** One of an editor's sections, in the order the person's task takes them: its title, its ⓘ, its fields. */
export type EditorSection = { id: string; title: Copy; help?: Copy; fields: ReactElement };

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
  editor,
  sections,
  danger,
  warning,
  closed,
}: {
  title: PageTitle;
  chip?: ChipProps;
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
        <FormClosed value={closed !== undefined}>
          {sections.map((section, index) => (
            <Section
              key={section.id}
              title={section.title}
              help={section.help}
              note={index === 0 ? closed : undefined}
              danger={index === last && closed === undefined ? danger : undefined}>
              {section.fields}
            </Section>
          ))}
        </FormClosed>
      </Form>
    </RailPage>
  );
}
