"use client";

import { EditorPage } from "@/kit/EditorPage";

import { COPY } from "@/core/copy";
import { useAufstellungEditor } from "@/features/aufstellungen/components/forms/useAufstellungEditor";

import { saveAufstellung } from "./saveAufstellung";

import type { Copy } from "@/core/copy";
import type { AufstellungEditing } from "@/features/aufstellungen/components/forms/useAufstellungEditor";
import type { ChipProps } from "@/kit/Chip";
import type { PageTitle } from "@/kit/RailFrame";

/** A closed line-up's chip, the lock's own word rather than a finished season's. */
const LOCKED_CHIP: ChipProps = { tone: "neutral", label: COPY.area.team.aufstellung.locked };

/**
 * The line-up's editor at the team's address: its save claims the seat at the club and the season the page was read
 * for, which the shared editor does not know.
 */
export function TeamAufstellung({
  team,
  saison,
  title,
  chip,
  lead,
  closed,
  ...editing
}: Omit<AufstellungEditing, "save"> & {
  team: string;
  saison: string;
  title: PageTitle;
  chip?: ChipProps;
  /** The fixture as the line under the title states it: when it is played, and when the line-up is due. */
  lead: Copy;
  /** Why the line-up is closed read-only to the team: the lock one hour before kick-off, from when the league alone writes it. */
  closed?: Copy;
}) {
  const { editor, barText, block } = useAufstellungEditor({
    ...editing,
    save: (change) => saveAufstellung({ ...change, team_id: team, saison_id: saison }),
  });
  return (
    <EditorPage
      title={title}
      chip={chip}
      lead={lead}
      editor={editor}
      barText={barText}
      closed={closed}
      closedChip={LOCKED_CHIP}
      sections={[{ id: "aufstellung", block }]}
    />
  );
}
