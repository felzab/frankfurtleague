"use client";

import { EditorPage } from "@/kit/EditorPage";

import { useAufstellungEditor } from "@/features/aufstellungen/components/forms/useAufstellungEditor";

import { saveAufstellung } from "./saveAufstellung";

import type { Copy } from "@/core/copy";
import type { AufstellungEditing } from "@/features/aufstellungen/components/forms/useAufstellungEditor";
import type { PageTitle } from "@/kit/RailFrame";

/**
 * The line-up's editor at the administrator's address: its save names the club the page was read for, which the
 * shared editor does not know.
 */
export function AdminAufstellung({
  team,
  title,
  lead,
  ...editing
}: Omit<AufstellungEditing, "save"> & {
  team: string;
  title: PageTitle;
  /** The line-up as the line under the title states it: whose it is, its matchday and when the match is played. */
  lead: Copy;
}) {
  const { editor, barText, block } = useAufstellungEditor({
    ...editing,
    save: (change) => saveAufstellung({ ...change, team_id: team }),
  });
  return (
    <EditorPage
      title={title}
      lead={lead}
      editor={editor}
      barText={barText}
      sections={[{ id: "aufstellung", block }]}
    />
  );
}
