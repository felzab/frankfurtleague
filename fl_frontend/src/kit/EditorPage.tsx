"use client";

import { useRef } from "react";

import { Form } from "react-aria-components/Form";

import { EditorBar } from "./EditorBar";
import { formColumn, RailPage } from "./RailFrame";
import { Section } from "./Section";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { ChipProps } from "./Chip";
import type { SaveWarning } from "./EditorBar";
import type { PageTitle } from "./RailFrame";
import type { DangerAct } from "./Section";
import type { Editor, EditorValue } from "./useEditor";

/** One of an editor's sections, in the order the person's task takes them: its title, its ⓘ, its fields. */
export type EditorSection = { id: string; title: Copy; help?: Copy; fields: ReactNode };

/**
 * The editor template: its sections one under another in the column of at most 760 px centred in the
 * content (`formColumn`, as the read page's), each a box exactly as tall as its content under its 16-px
 * title, and the record's one save in `EditorBar` at the foot of the viewport. There is no „Abbrechen“: the way out is the frame's „← Zurück“ to the record's list, which an
 * editor's route group places (`RailColumn`) and which asks before it drops unsaved changes. The last box ends in the danger rows, the
 * one place an editor's irreversible and retiring acts stand. The fields are the kit's, bound to `editor`'s
 * draft by the page's own client code.
 */
export function EditorPage<Values extends Record<string, EditorValue>>({
  title,
  chip,
  editor,
  sections,
  danger,
  warning,
}: {
  title: PageTitle;
  chip?: ChipProps;
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
      area="bereich"
      title={title}
      chip={chip}
      bar={
        <EditorBar
          status={editor.status}
          isPending={editor.isPending}
          warning={warning?.(editor.changes) ?? null}
          onSave={() => form.current?.requestSubmit()}
        />
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
        {sections.map((section, index) => (
          <Section
            key={section.id}
            title={section.title}
            help={section.help}
            danger={index === last ? danger : undefined}>
            {section.fields}
          </Section>
        ))}
      </Form>
    </RailPage>
  );
}
