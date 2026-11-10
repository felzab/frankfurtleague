import { Fragment, Suspense } from "react";

import { COPY } from "@/core/copy";

import { buttonPlaceholder } from "./buttonStyles";
import { formColumn, RailPage } from "./RailFrame";
import { editorBarLook } from "./railStyles";
import { SectionPlaceholder } from "./Section";
import { Placeholder, PlaceholderLine, Waiting } from "./Skeleton";

import type { Copy } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { DangerRowWait, FieldRow } from "./Section";

/** The editor once its record is read: the page's client editor, which places `EditorPage`. */
async function EditorBody({ editor }: { editor: Promise<ReactNode> }) {
  return await editor;
}

/**
 * What an editor is before its record is read: the Vorschau's line under the title where the editor has one, every
 * section it renders in their order, each its rows as the editor lays them out, with `note` where a state of the record
 * stands one under its title, a part drawing its own boxes (`EditorPage`'s `{ id, block }`) as `block`, that part's own
 * placeholder set bare as the part is, and `danger`, the rows of its danger box, where it has one. The page states it
 * beside the editor it reads, each section in its taller state, since a rail page's wait must never stand shorter than
 * the page.
 */
export type EditorWait = {
  lead?: true;
  sections: ReadonlyArray<ReadonlyArray<FieldRow> | { note: Copy; rows: ReadonlyArray<FieldRow> } | { block: ReactElement }>;
  danger?: ReadonlyArray<DangerRowWait>;
};

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
            {wait.sections.map((section, index) =>
              "block" in section ? (
                <Fragment key={index}>{section.block}</Fragment>
              ) : (
                <SectionPlaceholder
                  key={index}
                  {...("note" in section ? section : { rows: section })}
                />
              ),
            )}
            {wait.danger !== undefined && <SectionPlaceholder danger={wait.danger} />}
          </Waiting>
        </RailPage>
      }>
      <EditorBody editor={editor} />
    </Suspense>
  );
}
