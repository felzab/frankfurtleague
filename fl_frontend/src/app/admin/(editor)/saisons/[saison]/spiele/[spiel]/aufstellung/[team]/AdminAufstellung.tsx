"use client";

import { useAufstellungEditor } from "@/features/aufstellungen/useAufstellungEditor";
import { EditorPage } from "@/kit/EditorPage";

import { saveAufstellung } from "./saveAufstellung";

import type { BoxRules } from "@/core/boxRules";
import type { Copy } from "@/core/copy";
import type { AufstellungEditing } from "@/features/aufstellungen/useAufstellungEditor";
import type { ChipProps } from "@/kit/Chip";
import type { PageTitle } from "@/kit/RailFrame";

/**
 * The line-up's editor at the administrator's address: its save names the club the page was read for, which the
 * shared editor does not know.
 */
export function AdminAufstellung({
  team,
  rules,
  title,
  chip,
  lead,
  closed,
  ...editing
}: Omit<AufstellungEditing, "save"> & {
  team: string;
  /** What the save's lane asks of its boxes, read on the server. */
  rules: BoxRules;
  title: PageTitle;
  chip?: ChipProps;
  /** The line-up as the line under the title states it: its match, its matchday and when the match is played. */
  lead: Copy;
  /** Why the line-up is closed read-only: its season has finished, and the write refuses every change to it. */
  closed?: Copy;
}) {
  const { editor, barText, block } = useAufstellungEditor({
    ...editing,
    save: (change) => saveAufstellung({ ...change, team_id: team }),
  });
  return (
    <EditorPage
      title={title}
      chip={chip}
      lead={lead}
      editor={editor}
      rules={rules}
      barText={barText}
      closed={closed}
      sections={[{ id: "aufstellung", block }]}
    />
  );
}
