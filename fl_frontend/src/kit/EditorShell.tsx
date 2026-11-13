import { Fragment } from "react";

import { COPY } from "@/core/copy";

import { buttonPlaceholder } from "./buttonStyles";
import { formColumn, RailPage } from "./RailFrame";
import { editorBarLook } from "./railStyles";
import { editorHead, lockSlot, SectionPlaceholder } from "./Section";
import { Placeholder, PlaceholderLine, Waiting } from "./Skeleton";
import { PageWait } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { DangerRowWait, FieldRow } from "./Section";

/** The editor once its record is read: the page's client editor, which places `EditorPage`. */
async function EditorBody({ editor }: { editor: Promise<ReactNode> }) {
  return await editor;
}

/**
 * What an editor is before its record is read: the Vorschau's line under the title where the editor has one, every
 * section it renders in their order, each its rows as the editor lays them out, a part drawing its own boxes
 * (`EditorPage`'s `{ id, block }`) as `block`, that part's own placeholder set bare as the part is, and `danger`, the
 * rows of its danger box, where it has one. The page states it beside the editor it reads, each part in its taller
 * state, since a rail page's wait must never stand shorter than the page. The lock line's place stands in every wait,
 * empty, as it stands in every editor.
 */
export type EditorWait = {
  lead?: true;
  /** The words of the strip's way to the record's public page, where the editor lands with one most days (`RailPage`). */
  link?: Copy;
  sections: ReadonlyArray<ReadonlyArray<FieldRow> | { block: ReactElement }>;
  danger?: ReadonlyArray<DangerRowWait>;
};

/**
 * The editor template's server half, around the client one, `EditorPage`, which holds the form's state and so
 * cannot wait on the server: it awaits the editor the page reads, handed to it as a promise. The record names the page
 * and fills every field, so the whole page waits for it, and under `WholePages` the page arrives whole with it. Outside
 * `WholePages` that wait is the editor's one boundary, drawn meanwhile as a bar in the strip where the title will
 * stand, the placeholders of the editor's own sections in the column as `wait` states them, and the bar's place with
 * its save in the foot.
 */
export function EditorShell({ wait, editor }: { wait: EditorWait; editor: Promise<ReactNode> }) {
  return (
    <PageWait
      fallback={
        <RailPage
          scope="area"
          title={null}
          {...(wait.link === undefined ? {} : { link: { waits: wait.link } })}
          bar={
            <Placeholder layoutClass={editorBarLook().bar()}>
              <span className={editorBarLook().row()}>
                <span className={buttonPlaceholder()}>{COPY.shared.verb.save}</span>
              </span>
            </Placeholder>
          }>
          <Waiting layoutClass={formColumn()}>
            <div className={editorHead()}>
              {wait.lead === true && (
                <PlaceholderLine
                  textClass="text-sm"
                  widthClass="w-2/3"
                />
              )}
              {/* Empty: most editors land with nothing locked, and a bar here would vanish as they land. */}
              <p className={lockSlot()} />
            </div>
            {wait.sections.map((section, index) =>
              "block" in section ? (
                <Fragment key={index}>{section.block}</Fragment>
              ) : (
                <SectionPlaceholder
                  key={index}
                  rows={section}
                />
              ),
            )}
            {wait.danger !== undefined && <SectionPlaceholder danger={wait.danger} />}
          </Waiting>
        </RailPage>
      }>
      <EditorBody editor={editor} />
    </PageWait>
  );
}
