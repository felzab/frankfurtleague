import { Suspense } from "react";

import { formColumn, RailPage } from "./RailFrame";
import { Skeleton } from "./Skeleton";

import type { ReactNode } from "react";

/** The editor once its record is read: the page's client editor, which places `EditorPage`. */
async function EditorBody({ editor }: { editor: Promise<ReactNode> }) {
  return await editor;
}

/**
 * The editor template's server half, around the client one, `EditorPage`, which holds the form's state and so
 * cannot wait on the server: the editor's one boundary. The record names the page and fills every field, so
 * the whole page waits for it; meanwhile the strip holds a bar where the title will stand and the column the
 * skeleton of the sections. The page hands it the editor it reads, as a promise.
 */
export function EditorShell({ editor }: { editor: Promise<ReactNode> }) {
  return (
    <Suspense
      fallback={
        <RailPage
          scope="area"
          title={null}>
          <div className={formColumn()}>
            <Skeleton shape="sections" />
          </div>
        </RailPage>
      }>
      <EditorBody editor={editor} />
    </Suspense>
  );
}
