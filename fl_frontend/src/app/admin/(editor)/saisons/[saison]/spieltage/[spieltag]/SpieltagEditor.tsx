"use client";

import { ADMIN_COPY } from "@/core/copy/admin";
import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { FieldRows } from "@/kit/FieldRows";
import { useEditor } from "@/kit/useEditor";

import { requiredOf } from "./spieltagValues";

import type { ActionAnswer } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { Copy } from "@/core/copy";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpieltagValues } from "./spieltagValues";

const WORDS = ADMIN_COPY.saison;

/**
 * The matchday editor: its first and last day, one value in one box as a season's span is, saved from the editor's
 * bar. A matchday has no danger act: the draw alone makes or removes one.
 */
export function SpieltagEditor({
  title,
  record,
  save,
  rules,
  closed,
}: {
  title: PageTitle;
  record: EditorRecord<SpieltagValues>;
  save: (change: EditorSave<SpieltagValues>) => Promise<ActionAnswer<number>>;
  /** What the save's lane asks of its boxes, read on the server. */
  rules: BoxRules;
  /** Why the matchday is closed read-only: its season has finished, and the write refuses every change to it. */
  closed?: Copy;
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;

  return (
    <EditorPage
      title={title}
      editor={editor}
      rules={rules}
      // The write takes both dates.
      requiredOf={requiredOf}
      closed={closed}
      sections={[
        {
          id: "period",
          title: WORDS.period,
          fields: (
            <FieldRows>
              <DateField
                label={WORDS.start}
                name="start"
                value={draft.start}
                onChange={(start) => set("start", start)}
              />
              <DateField
                label={WORDS.end}
                name="end"
                value={draft.end}
                onChange={(end) => set("end", end)}
                // A span ending before it begins is refused here, before the write sees it.
                {...(draft.start === null ? {} : { minValue: draft.start })}
              />
            </FieldRows>
          ),
        },
      ]}
    />
  );
}
