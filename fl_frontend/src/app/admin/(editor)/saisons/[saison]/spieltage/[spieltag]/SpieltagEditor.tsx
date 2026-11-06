"use client";

import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { FieldColumns } from "@/kit/FieldColumns";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpieltagValues } from "./spieltagValues";

const WORDS = COPY.admin.saison;

/**
 * The matchday editor: its first and last day, one value in one box as a season's span is, saved from the editor's
 * bar. A matchday has no danger act: the draw alone makes or removes one.
 */
export function SpieltagEditor({
  title,
  record,
  save,
  required,
  closed,
}: {
  title: PageTitle;
  record: EditorRecord<SpieltagValues>;
  save: (change: EditorSave<SpieltagValues>) => Promise<ActionAnswer<number>>;
  /** Whether the write takes the matchday without each date, read off its schema on the server. */
  required: { start: boolean; end: boolean };
  /** Why the matchday is closed read-only: its season has finished, and the write refuses every change to it. */
  closed?: Copy;
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;

  return (
    <EditorPage
      title={title}
      editor={editor}
      closed={closed}
      sections={[
        {
          id: "zeitraum",
          title: WORDS.zeitraum,
          fields: (
            // A span's two ends, sharing their row at every width.
            <FieldColumns>
              <DateField
                label={WORDS.start}
                name="start"
                isRequired={required.start}
                value={draft.start}
                onChange={(start) => set("start", start)}
              />
              <DateField
                label={WORDS.end}
                name="end"
                isRequired={required.end}
                value={draft.end}
                onChange={(end) => set("end", end)}
                // A span ending before it begins is refused here, before the write sees it.
                {...(draft.start === null ? {} : { minValue: draft.start })}
              />
            </FieldColumns>
          ),
        },
      ]}
    />
  );
}
