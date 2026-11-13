import type { ReactNode } from "react";

/** The editor once its record is read: the page's client editor, which places `EditorPage`. */
async function EditorBody({ editor }: { editor: Promise<ReactNode> }) {
  return await editor;
}

/**
 * The editor template's server half, around the client one, `EditorPage`, which holds the form's state and so
 * cannot wait on the server: it awaits the editor the page reads, handed to it as a promise. The record names the page
 * and fills every field, so the page arrives whole with it.
 */
export function EditorShell({ editor }: { editor: Promise<ReactNode> }) {
  return <EditorBody editor={editor} />;
}
