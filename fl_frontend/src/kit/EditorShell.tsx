import { Suspense } from "react";

import { COPY } from "@/core/copy";

import { buttonPlaceholder } from "./buttonStyles";
import { formColumn, RailPage } from "./RailFrame";
import { editorBarLook } from "./railStyles";
import { SectionPlaceholder } from "./Section";
import { Placeholder, PlaceholderLine, Waiting } from "./Skeleton";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { FieldRow } from "./Section";

/** The editor once its record is read: the page's client editor, which places `EditorPage`. */
async function EditorBody({ editor }: { editor: Promise<ReactNode> }) {
  return await editor;
}

/**
 * What an editor is before its record is read: the Vorschau's line under the title where the editor has one, every
 * section it renders in their order, each its rows as the editor lays them out, and `danger`, the labels of the acts its
 * danger box holds, where it has one. The page states it beside the editor it reads.
 */
export type EditorWait = { lead?: true; sections: ReadonlyArray<ReadonlyArray<FieldRow>>; danger?: ReadonlyArray<Copy> };

/**
 * The editor template's server half, around the client one, `EditorPage`, which holds the form's state and so
 * cannot wait on the server: the editor's one boundary. The record names the page and fills every field, so
 * the whole page waits for it; meanwhile the strip holds a bar where the title will stand, the column the
 * placeholders of the editor's own sections as `wait` states them, and the foot the bar's place with its save. The
 * page hands it the editor it reads, as a promise.
 */
export function EditorShell({ wait, editor }: { wait: EditorWait; editor: Promise<ReactNode> }) {
  return (
    <Suspense
      fallback={
        <RailPage
          scope="area"
          title={null}
          bar={
            <Placeholder layout={editorBarLook().bar()}>
              <span className={editorBarLook().row()}>
                <span className="min-w-0 flex-1" />
                <span className={buttonPlaceholder()}>{COPY.shared.verb.save}</span>
              </span>
            </Placeholder>
          }>
          <Waiting layout={formColumn()}>
            {wait.lead === true && (
              <PlaceholderLine
                text="text-sm"
                width="w-2/3"
              />
            )}
            {wait.sections.map((rows, index) => (
              <SectionPlaceholder
                key={index}
                rows={rows}
              />
            ))}
            {wait.danger !== undefined && <SectionPlaceholder danger={wait.danger} />}
          </Waiting>
        </RailPage>
      }>
      <EditorBody editor={editor} />
    </Suspense>
  );
}
