"use client";

import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { FieldPair } from "@/kit/FieldPair";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpieltagValues } from "./spieltagValues";

const WORDS = COPY.admin.spiel;

/**
 * The matchday editor: its first and last day, one value in one box as a season's span is, saved from the editor's
 * bar. A matchday has no danger act: the draw alone makes or removes one.
 */
export function SpieltagEditor({
  title,
  record,
  save,
  required,
}: {
  title: PageTitle;
  record: EditorRecord<SpieltagValues>;
  save: (change: EditorSave<SpieltagValues>) => Promise<ActionAnswer<number>>;
  /** Whether the write takes the matchday without each date, read off its schema on the server. */
  required: { beginn: boolean; ende: boolean };
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;

  return (
    <EditorPage
      title={title}
      editor={editor}
      sections={[
        {
          id: "zeitraum",
          title: COPY.admin.saison.zeitraum,
          fields: (
            // A span's two ends are one value, sharing their row at every width.
            <FieldPair
              short="both"
              phone="pair">
              <DateField
                label={WORDS.beginn}
                name="beginn"
                isRequired={required.beginn}
                value={draft.beginn}
                onChange={(beginn) => set("beginn", beginn)}
              />
              <DateField
                label={WORDS.ende}
                name="ende"
                isRequired={required.ende}
                value={draft.ende}
                onChange={(ende) => set("ende", ende)}
                // A span ending before it begins is refused here, before the write sees it.
                {...(draft.beginn === null ? {} : { minValue: draft.beginn })}
              />
            </FieldPair>
          ),
        },
      ]}
    />
  );
}
